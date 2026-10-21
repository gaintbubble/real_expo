"use server";

import prisma from './lib/prisma';
import { getISTStartAndEndOfDay } from './lib/dateUtils';
import { normalizeStatus, isBatchSample } from './lib/statusUtils';

export async function saveBarcodeToDatabase(barcode: string, activeTab?: string) {
  try {
    let cleanBarcode = barcode.trim();
    let requestedTests: string[] = [];
    if (cleanBarcode.includes(':')) {
      const parts = cleanBarcode.split(':');
      cleanBarcode = parts[0].trim();
      const testsPart = parts.slice(1).join(':').trim();
      if (testsPart) {
        requestedTests = testsPart.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const existing = await prisma.trackedSample.findUnique({
      where: { barcode: cleanBarcode }
    });

    if (existing) {
      return { success: false, message: "Barcode already exists!" };
    }

    const scanTime = new Date();
    const effectiveDeptName = (activeTab && activeTab.trim()) ? activeTab.trim() : "HAEMATOLOGY";

    const depts = await prisma.department.findMany({
      include: { tests: true }
    });

    let activeDept = depts.find(d => d.name.toLowerCase() === effectiveDeptName.toLowerCase());
    if (!activeDept) {
      activeDept = depts.find(d => d.name.toLowerCase() === 'haematology') || depts[0];
    }

    // Strict Toggle Evaluation:
    // If trigger_enabled === false OR trigger_time === 0 (or null):
    // Set initial delay = 0 minutes. No countdown timer!
    // Immediately initiate check with status 'Checking...'
    // Only if trigger_enabled === true and triggerTime > 0, use configured duration.
    let triggerDelayMins = 0;
    if (activeDept && activeDept.triggerTime != null && activeDept.triggerTime > 0) {
      triggerDelayMins = activeDept.triggerTime;
    } else {
      triggerDelayMins = 0;
    }

    // Resolve order test configs
    const allConfigs = await prisma.testConfig.findMany({
      include: { department: true }
    });

    let resolvedTestDetails: any[] = [];
    let serviceCds: string[] = [];
    let displayTestNames: string[] = [];

    if (requestedTests.length > 0) {
      for (const reqName of requestedTests) {
        const lowerReq = reqName.toLowerCase();
        const matchedCfg = allConfigs.find(c => 
          (c.shortName && c.shortName.toLowerCase() === lowerReq) ||
          (c.testName && c.testName.toLowerCase() === lowerReq) ||
          (c.serviceCd && c.serviceCd.toLowerCase() === lowerReq)
        );

        if (matchedCfg) {
          const testLabel = matchedCfg.shortName || matchedCfg.testName;
          resolvedTestDetails.push({
            name: testLabel,
            testName: matchedCfg.testName,
            shortName: matchedCfg.shortName,
            serviceCd: matchedCfg.serviceCd || undefined,
            status: "Pending Check",
            intervalTime: matchedCfg.intervalTime || 10,
            intervalTimeVerified: matchedCfg.intervalTimeVerified ?? null,
            department: matchedCfg.department?.name || (activeDept ? activeDept.name : effectiveDeptName)
          });
          if (matchedCfg.serviceCd) serviceCds.push(matchedCfg.serviceCd);
          displayTestNames.push(testLabel);
        } else {
          resolvedTestDetails.push({
            name: reqName,
            testName: reqName,
            status: "Pending Check",
            intervalTime: 10,
            intervalTimeVerified: 15,
            department: activeDept ? activeDept.name : effectiveDeptName
          });
          displayTestNames.push(reqName);
        }
      }
    } else {
      // Barcode scanned without explicit test suffix:
      // Do NOT set hardcoded "CBC"! Show clean placeholder "Resolving..."
      // Test details will be populated once the initial check runs.
      displayTestNames.push("Resolving...");
    }

    const finalTestName = displayTestNames.join(', ');
    const finalServiceCd = serviceCds.length > 0 ? serviceCds.join(', ') : `DEPT:${activeDept ? activeDept.name : effectiveDeptName}`;

    const nextCheckTime = triggerDelayMins > 0 ? new Date(scanTime.getTime() + triggerDelayMins * 60000) : scanTime;
    const initialStatus = triggerDelayMins > 0 ? "Pending Check" : "Checking...";
    const initialTestName = displayTestNames.length > 0 && displayTestNames[0] !== "Resolving..." 
      ? finalTestName 
      : (triggerDelayMins > 0 ? "Resolving..." : "Fetching from LIS...");

    const sample = await prisma.trackedSample.create({
      data: {
        barcode: cleanBarcode,
        currentStatus: initialStatus,
        receivedTime: null,
        resultTime: null,
        testName: initialTestName,
        patientName: "--",
        serviceCd: finalServiceCd,
        testDetails: JSON.stringify(resolvedTestDetails),
        createdAt: scanTime,
        nextCheckTime: nextCheckTime
      }
    });

    await prisma.statusHistory.create({
      data: {
        sampleId: sample.id,
        status: initialStatus,
        timestamp: scanTime
      }
    });

    return { 
      success: true, 
      sample, 
      triggerDelayMins,
      scanTime: scanTime.toISOString(),
      nextCheckTime: nextCheckTime.toISOString()
    };
  } catch (error) {
    console.error("Save barcode error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function getAllTrackedSamples(dateStr?: string) {
  try {
    let whereClause = {};
    if (dateStr && dateStr !== '--') {
      const { startOfDay, endOfDay } = getISTStartAndEndOfDay(dateStr);
      whereClause = {
        OR: [
          { createdAt: { gte: startOfDay, lte: endOfDay } },
          { receivedTime: { gte: startOfDay, lte: endOfDay } },
          { resultTime: { gte: startOfDay, lte: endOfDay } }
        ]
      };
    }

    const samples = await prisma.trackedSample.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: dateStr ? undefined : 1000
    });

    const departmentsList = await prisma.department.findMany();
    const deptMap = new Map(departmentsList.map(d => [d.name.toLowerCase(), { name: d.name, triggerTime: d.triggerTime, provisionalTime: d.provisionalTime }]));

    // Query all test configs so every test in testDetails can be matched by serviceCd or testName
    const allConfigs = await prisma.testConfig.findMany({
      include: { department: true }
    });

    const configByServiceCd = new Map<string, any>();
    const configByName = new Map<string, any>();

    allConfigs.forEach(c => {
      const info = {
        name: c.shortName || c.testName,
        testName: c.testName,
        shortName: c.shortName,
        serviceCd: c.serviceCd,
        department: c.department?.name,
        triggerTime: c.department?.triggerTime,
        provisionalTime: c.department?.provisionalTime,
        intervalTime: c.intervalTime,
        intervalTimeVerified: c.intervalTimeVerified
      };
      if (c.serviceCd) {
        configByServiceCd.set(c.serviceCd.toLowerCase().trim(), info);
      }
      if (c.testName) {
        configByName.set(c.testName.toLowerCase().trim(), info);
      }
      if (c.shortName) {
        configByName.set(c.shortName.toLowerCase().trim(), info);
      }
    });

    const now = new Date();

    // Check pre-check samples: handle live countdown, checking, and check-failed lifecycle
    // NEVER inject hardcoded "CBC" or "Sample Collected" dummy data!
    for (const s of samples) {
      let normStatus = normalizeStatus(s.currentStatus, s.barcode, s.testName, s.serviceCd);
      const isPreCheck = (normStatus === 'Pending Check' || normStatus === 'Checking...' || normStatus === 'Check Failed' || normStatus === 'Extension Not Responding') && !s.receivedTime;

      if (isPreCheck) {
        const checkTargetMs = s.nextCheckTime ? new Date(s.nextCheckTime).getTime() : 0;
        const isFutureCountdown = checkTargetMs > now.getTime();

        if (isFutureCountdown) {
          normStatus = 'Pending Check';
          s.currentStatus = 'Pending Check';
          if (!s.testName || s.testName === 'CBC') {
            s.testName = 'Resolving...';
          }
        } else {
          // Timer has elapsed or trigger was 0 / disabled
          if (normStatus === 'Check Failed' || normStatus === 'Extension Not Responding') {
            s.currentStatus = normStatus;
            if (!s.testName || s.testName === 'Resolving...' || s.testName === 'Fetching from LIS...' || s.testName === 'CBC') {
              s.testName = 'Not Found';
            }
          } else if (normStatus === 'Checking...') {
            const scanMs = s.createdAt ? new Date(s.createdAt).getTime() : checkTargetMs;
            const refMs = checkTargetMs > 0 ? checkTargetMs : scanMs;
            const elapsedSecs = refMs > 0 ? Math.floor((now.getTime() - refMs) / 1000) : 10;

            if (elapsedSecs >= 10) {
              normStatus = 'Extension Not Responding';
              s.currentStatus = 'Extension Not Responding';
              if (!s.testName || s.testName === 'Resolving...' || s.testName === 'Fetching from LIS...' || s.testName === 'CBC') {
                s.testName = 'Not Found';
              }
            } else {
              s.currentStatus = 'Checking...';
              if (!s.testName || s.testName === 'Resolving...' || s.testName === 'CBC') {
                s.testName = 'Fetching from LIS...';
              }
            }
          } else {
            // Pending Check whose countdown timer has reached 0
            const elapsedSecs = checkTargetMs > 0 ? Math.floor((now.getTime() - checkTargetMs) / 1000) : 10;
            if (elapsedSecs >= 10) {
              normStatus = 'Extension Not Responding';
              s.currentStatus = 'Extension Not Responding';
              if (!s.testName || s.testName === 'Resolving...' || s.testName === 'Fetching from LIS...' || s.testName === 'CBC') {
                s.testName = 'Not Found';
              }
            } else {
              normStatus = 'Checking...';
              s.currentStatus = 'Checking...';
              if (!s.testName || s.testName === 'Resolving...' || s.testName === 'CBC') {
                s.testName = 'Fetching from LIS...';
              }
            }
          }
        }
      } else {
        s.currentStatus = normStatus;
      }
    }

    return samples.map(s => {
      let minTriggerTime = Infinity;
      let minProvisionalTime = Infinity;
      let minIntervalTime = Infinity;
      let minIntervalTimeVerified = Infinity;

      let departments: string[] = [];

      // Parse individual test details and attach test-level SLA configurations
      let parsedDetails: any[] = [];
      if (s.testDetails) {
        try {
          parsedDetails = JSON.parse(s.testDetails);
        } catch {
          parsedDetails = [];
        }
      }

      const enhancedTestDetails = parsedDetails.map((td: any) => {
        const nameKey = (td.name || '').toLowerCase().trim();
        const cdKey = (td.serviceCd || '').toLowerCase().trim();
        const cfg = (cdKey ? configByServiceCd.get(cdKey) : null) || configByName.get(nameKey);

        const intervalTime = cfg?.intervalTime ?? 30; // Configured result entry time (mins)
        const intervalTimeVerified = cfg?.intervalTimeVerified ?? null; // Configured verification time (mins, or null if none)
        const testDept = cfg?.department;

        if (testDept && !departments.includes(testDept)) {
          departments.push(testDept);
        }
        if (cfg?.triggerTime != null && cfg.triggerTime < minTriggerTime) minTriggerTime = cfg.triggerTime;
        if (cfg?.provisionalTime != null && cfg.provisionalTime < minProvisionalTime) minProvisionalTime = cfg.provisionalTime;
        if (intervalTime < minIntervalTime) minIntervalTime = intervalTime;
        if (intervalTimeVerified != null && intervalTimeVerified < minIntervalTimeVerified) minIntervalTimeVerified = intervalTimeVerified;

        return {
          ...td,
          serviceCd: td.serviceCd || cfg?.serviceCd,
          intervalTime,
          intervalTimeVerified,
          department: testDept || td.department
        };
      });

      let displayTestName = s.testName;
      const isResolvingTest = s.testName === 'Resolving...' || s.testName === 'Pending Check...';

      // Always extract departments and SLA configurations from serviceCd regardless of test resolution state
      if (s.serviceCd) {
        if (s.serviceCd.startsWith('DEPT:')) {
          const deptName = s.serviceCd.substring(5).trim();
          if (deptName && !departments.includes(deptName)) {
            departments.push(deptName);
          }
          const deptData = deptMap.get(deptName.toLowerCase());
          if (deptData?.triggerTime != null && deptData.triggerTime < minTriggerTime) minTriggerTime = deptData.triggerTime;
          if (deptData?.provisionalTime != null && deptData.provisionalTime < minProvisionalTime) minProvisionalTime = deptData.provisionalTime;
        } else {
          const individualCds = s.serviceCd.split(',').map((cd: string) => cd.trim());
          const originalTestNames = (s.testName || '').split(',').map((name: string) => name.trim());
          
          const resolvedNames = individualCds.map((cd: string, index: number) => {
            const mapped = configByServiceCd.get(cd.toLowerCase());
            if (mapped) {
              if (mapped.department && !departments.includes(mapped.department)) {
                departments.push(mapped.department);
              }
              if (mapped.triggerTime != null && mapped.triggerTime < minTriggerTime) minTriggerTime = mapped.triggerTime;
              if (mapped.provisionalTime != null && mapped.provisionalTime < minProvisionalTime) minProvisionalTime = mapped.provisionalTime;
              if (mapped.intervalTime != null && mapped.intervalTime < minIntervalTime) minIntervalTime = mapped.intervalTime;
              if (mapped.intervalTimeVerified != null && mapped.intervalTimeVerified < minIntervalTimeVerified) minIntervalTimeVerified = mapped.intervalTimeVerified;
              
              return mapped.name;
            }
            return originalTestNames[index] || cd;
          });

          if (!isResolvingTest) {
            displayTestName = resolvedNames.join(', ');
          }
        }
      }

      if (isResolvingTest) {
        displayTestName = 'Resolving...';
      }

      if (departments.length === 0 && s.testName && !isResolvingTest) {
        const mappedByName = configByName.get(s.testName.toLowerCase().trim());
        if (mappedByName) {
          if (mappedByName.department && !departments.includes(mappedByName.department)) {
            departments.push(mappedByName.department);
          }
          if (mappedByName.triggerTime != null && mappedByName.triggerTime < minTriggerTime) minTriggerTime = mappedByName.triggerTime;
          if (mappedByName.provisionalTime != null && mappedByName.provisionalTime < minProvisionalTime) minProvisionalTime = mappedByName.provisionalTime;
        }
      }

      // Guarantee tracked samples are always assigned HAEMATOLOGY as primary default if empty
      if (departments.length === 0) {
        departments.push('HAEMATOLOGY');
      }

      // Strict Toggle Evaluation: If minTriggerTime is not set from configs, deduce from department configuration
      if (minTriggerTime === Infinity) {
        for (const d of departments) {
          const deptObj = deptMap.get(d.toLowerCase());
          if (deptObj?.triggerTime != null && deptObj.triggerTime > 0) {
            minTriggerTime = deptObj.triggerTime;
            break;
          }
        }
        if (minTriggerTime === Infinity) {
          minTriggerTime = 0;
        }
      }

      return {
        ...s,
        displayTestName,
        testDetails: JSON.stringify(enhancedTestDetails),
        departments,
        triggerTime: (minTriggerTime !== Infinity && minTriggerTime > 0) ? minTriggerTime : 0,
        provisionalTime: minProvisionalTime === Infinity ? null : minProvisionalTime,
        intervalTime: minIntervalTime === Infinity ? null : minIntervalTime,
        intervalTimeVerified: minIntervalTimeVerified === Infinity ? null : minIntervalTimeVerified,
        isProvisional: Boolean(s.isProvisional),
        provisionalExpiry: s.provisionalExpiry ? s.provisionalExpiry.toISOString() : null,
        nextCheckTime: s.nextCheckTime ? s.nextCheckTime.toISOString() : null,
      };
    });
  } catch (error) {
    console.error("Get samples error:", error);
    return [];
  }
}

export async function clearAllSamples() {
  try {
    await prisma.statusHistory.deleteMany({});
    await prisma.trackedSample.deleteMany({});
    return { success: true };
  } catch (error) {
    console.error("Clear samples error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function deleteSample(id: string) {
  try {
    await prisma.statusHistory.deleteMany({ where: { sampleId: id } });
    await prisma.trackedSample.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    console.error("Delete sample error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function updateSampleBarcode(id: string, newBarcode: string) {
  try {
    const existing = await prisma.trackedSample.findUnique({
      where: { barcode: newBarcode }
    });

    if (existing && existing.id !== id) {
      return { success: false, message: "Barcode already exists!" };
    }

    const sample = await prisma.trackedSample.update({
      where: { id },
      data: { barcode: newBarcode }
    });
    return { success: true, sample };
  } catch (error) {
    console.error("Update sample error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function markSampleReceived(id: string, isResultCompleted: boolean = false) {
  try {
    const existingSample = await prisma.trackedSample.findUnique({ where: { id } });
    if (!existingSample) return { success: false, message: "Sample not found" };

    const now = new Date();

    // Parse existing testDetails
    let testDetails: any[] = [];
    if (existingSample.testDetails) {
      try {
        testDetails = JSON.parse(existingSample.testDetails);
      } catch {
        testDetails = [];
      }
    }

    // Determine configured SLAs
    let minInterval = 10;
    let minIntervalVerified: number | null = null;
    let hasVerification = false;

    if (testDetails.length > 0) {
      const validIntervals = testDetails.map((t: any) => t.intervalTime).filter((t: any) => typeof t === 'number' && t > 0);
      if (validIntervals.length > 0) minInterval = Math.min(...validIntervals);

      const validVerifs = testDetails.map((t: any) => t.intervalTimeVerified).filter((v: any) => typeof v === 'number' && v > 0);
      if (validVerifs.length > 0) {
        hasVerification = true;
        minIntervalVerified = Math.min(...validVerifs);
      }
    }

    if (isResultCompleted) {
      // 1. "Result Completed" is checked by user in modal:
      // Immediately set the test status to Result Done.
      // Completely bypass/skip the "Result Done" SLA countdown and checking process.
      // If the test has a verification SLA configured in Test Config, immediately transition to Phase 3 (Verification Tracking),
      // calculating the verification deadline starting from this exact completion timestamp.
      const updatedDetails = testDetails.map((t: any) => ({
        ...t,
        status: "Result Done",
        resultTime: now.toISOString()
      }));

      let isCompleted = false;
      let nextCheckTime: Date | null = null;
      let expectedEndTime: Date | null = null;

      if (hasVerification && minIntervalVerified != null && minIntervalVerified > 0) {
        // Active Verification SLA Tracking starting from this exact completion timestamp
        expectedEndTime = new Date(now.getTime() + minIntervalVerified * 60000);
        nextCheckTime = expectedEndTime;
        isCompleted = false;
      } else {
        // No Verification SLA configured -> workflow terminates at Result Done. Marked Completed!
        isCompleted = true;
        nextCheckTime = null;
        expectedEndTime = now;
      }

      const sample = await prisma.trackedSample.update({
        where: { id },
        data: {
          currentStatus: "Result Done",
          receivedTime: now,
          resultTime: now,
          isCompleted: isCompleted,
          nextCheckTime: nextCheckTime,
          expectedEndTime: expectedEndTime,
          testDetails: updatedDetails.length > 0 ? JSON.stringify(updatedDetails) : existingSample.testDetails
        }
      });

      await prisma.statusHistory.create({
        data: {
          sampleId: id,
          status: "Sample Received",
          timestamp: now
        }
      });

      await prisma.statusHistory.create({
        data: {
          sampleId: id,
          status: "Result Done",
          timestamp: now
        }
      });

      return { success: true, sample };
    } else {
      // 2. "Result Completed" is NOT checked:
      // Transition to Sample Received and begin counting down the Result Done SLA from the received timestamp.
      const updatedDetails = testDetails.map((t: any) => {
        const tsLower = (t.status || '').toLowerCase();
        if (!tsLower.includes('done') && !tsLower.includes('completed') && !tsLower.includes('verified') && !tsLower.includes('approved')) {
          return { ...t, status: "Sample Received" };
        }
        return t;
      });

      const expectedEndTime = new Date(now.getTime() + minInterval * 60000);
      const nextCheckTime = expectedEndTime;

      const sample = await prisma.trackedSample.update({
        where: { id },
        data: {
          currentStatus: "Sample Received",
          receivedTime: now,
          isCompleted: false,
          nextCheckTime: nextCheckTime,
          expectedEndTime: expectedEndTime,
          testDetails: updatedDetails.length > 0 ? JSON.stringify(updatedDetails) : existingSample.testDetails
        }
      });

      await prisma.statusHistory.create({
        data: {
          sampleId: id,
          status: "Sample Received",
          timestamp: now
        }
      });

      return { success: true, sample };
    }
  } catch (error) {
    console.error("Mark sample received error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function extendSampleTime(id: string, testNames: string[], extraTimeMins: number, delayReason: string) {
  try {
    const existingSample = await prisma.trackedSample.findUnique({ where: { id } });
    if (!existingSample) return { success: false, message: "Sample not found" };

    const newExpectedEndTime = new Date(Date.now() + extraTimeMins * 60000);
    const nextCheckTime = new Date();

    let updatedTestDetails = existingSample.testDetails;
    if (existingSample.testDetails) {
      try {
        const details = JSON.parse(existingSample.testDetails);
        const newDetails = details.map((t: any) => {
          if (testNames.includes(t.name)) {
            return { ...t, delayReason, extraTime: extraTimeMins };
          }
          return t;
        });
        updatedTestDetails = JSON.stringify(newDetails);
      } catch (e) {
        // ignore JSON parse error
      }
    }

    const sample = await prisma.trackedSample.update({
      where: { id },
      data: {
        expectedEndTime: newExpectedEndTime,
        nextCheckTime: nextCheckTime,
        testDetails: updatedTestDetails
      }
    });

    return { success: true, sample };
  } catch (error) {
    console.error("Extend sample time error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function simulateFalseTrigger(id: string, type: 'trigger' | 'result' | 'verification' | 'collected') {
  try {
    const existingSample = await prisma.trackedSample.findUnique({ where: { id } });
    if (!existingSample) return { success: false, message: "Sample not found" };

    const updateData: any = {};
    const now = new Date();

    if (type === 'collected') {
      const isBatch = isBatchSample(existingSample.barcode, existingSample.testName, existingSample.serviceCd);
      const newStatus = isBatch ? "Batch Generated" : "Sample Collected";
      updateData.currentStatus = newStatus;
      updateData.receivedTime = null;
      updateData.resultTime = null;
      updateData.isCompleted = false;
      if (existingSample.testDetails) {
        try {
          const details = JSON.parse(existingSample.testDetails);
          const newDetails = details.map((t: any) => ({ ...t, status: newStatus }));
          updateData.testDetails = JSON.stringify(newDetails);
        } catch(e) {}
      }
    } else if (type === 'trigger') {
      updateData.currentStatus = "Sample Received";
      updateData.receivedTime = now;
      if (existingSample.testDetails) {
        try {
          const details = JSON.parse(existingSample.testDetails);
          const newDetails = details.map((t: any) => ({ ...t, status: 'Sample Received' }));
          updateData.testDetails = JSON.stringify(newDetails);
        } catch(e) {}
      }
    } else if (type === 'result') {
      updateData.currentStatus = "Result Done"; 
      updateData.resultTime = now;
      if (existingSample.testDetails) {
        try {
          const details = JSON.parse(existingSample.testDetails);
          const newDetails = details.map((t: any) => ({ ...t, status: 'Result Done', resultTime: now.toISOString() }));
          updateData.testDetails = JSON.stringify(newDetails);
        } catch(e) {}
      }
    } else if (type === 'verification') {
      updateData.currentStatus = "Verified";
      updateData.isCompleted = true;
      if (existingSample.testDetails) {
        try {
          const details = JSON.parse(existingSample.testDetails);
          const newDetails = details.map((t: any) => ({ ...t, status: 'Verified' }));
          updateData.testDetails = JSON.stringify(newDetails);
        } catch(e) {}
      }
    }

    const sample = await prisma.trackedSample.update({
      where: { id },
      data: updateData
    });

    await prisma.statusHistory.create({
      data: {
        status: updateData.currentStatus,
        sampleId: id,
        timestamp: now
      }
    });

    return { success: true, sample };
  } catch (error) {
    console.error("False trigger error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function toggleSampleProvisional(id: string, enable?: boolean) {
  try {
    const existing = await prisma.trackedSample.findUnique({ where: { id } });
    if (!existing) return { success: false, message: "Sample not found" };

    const shouldEnable = enable !== undefined ? enable : !existing.isProvisional;

    if (shouldEnable) {
      // Find the department provisional time for this sample
      let provMins = 60; // fallback default
      const departmentsList = await prisma.department.findMany();
      const deptMap = new Map(departmentsList.map(d => [d.name, d.provisionalTime]));

      if (existing.serviceCd) {
        if (existing.serviceCd.startsWith('DEPT:')) {
          const deptName = existing.serviceCd.substring(5);
          const t = deptMap.get(deptName);
          if (t != null && t > 0) provMins = t;
        } else {
          const individualCds = existing.serviceCd.split(',').map(cd => cd.trim());
          const configs = await prisma.testConfig.findMany({
            where: { serviceCd: { in: individualCds } },
            include: { department: true }
          });
          const provTimes = configs.map(c => c.department.provisionalTime).filter(t => t != null && t > 0) as number[];
          if (provTimes.length > 0) {
            provMins = Math.min(...provTimes);
          }
        }
      }

      const expiry = new Date(Date.now() + provMins * 60000);

      const updated = await prisma.trackedSample.update({
        where: { id },
        data: {
          isProvisional: true,
          provisionalExpiry: expiry,
          nextCheckTime: expiry
        }
      });

      await prisma.statusHistory.create({
        data: {
          sampleId: id,
          status: `Provisional ON (${provMins}m)`
        }
      });

      return { 
        success: true, 
        isProvisional: true, 
        provisionalExpiry: expiry.toISOString(), 
        sample: updated,
        mins: provMins 
      };
    } else {
      // Turn OFF provisional mode -> resume checking immediately
      const updated = await prisma.trackedSample.update({
        where: { id },
        data: {
          isProvisional: false,
          provisionalExpiry: null,
          nextCheckTime: new Date()
        }
      });

      await prisma.statusHistory.create({
        data: {
          sampleId: id,
          status: "Provisional OFF"
        }
      });

      return { 
        success: true, 
        isProvisional: false, 
        provisionalExpiry: null, 
        sample: updated 
      };
    }
  } catch (error) {
    console.error("Toggle provisional error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function retrySampleCheck(id: string, barcode?: string) {
  try {
    const now = new Date();
    const updated = await prisma.trackedSample.update({
      where: { id },
      data: {
        currentStatus: "Checking...",
        testName: "Fetching from LIS...",
        nextCheckTime: now
      }
    });

    await prisma.statusHistory.create({
      data: {
        sampleId: id,
        status: "Checking...",
        timestamp: now
      }
    });

    return { success: true, sample: updated };
  } catch (error) {
    console.error("retrySampleCheck error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function triggerBarcodeCheckServer(id: string, barcode?: string) {
  try {
    const now = new Date();
    const updated = await prisma.trackedSample.update({
      where: { id },
      data: {
        currentStatus: "Checking...",
        testName: "Fetching from LIS..."
      }
    });

    await prisma.statusHistory.create({
      data: {
        sampleId: id,
        status: "Checking...",
        timestamp: now
      }
    });

    return { success: true, sample: updated };
  } catch (error) {
    console.error("triggerBarcodeCheckServer error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function markCheckFailed(id: string, barcode?: string, reason: string = "Extension Not Responding") {
  try {
    const updated = await prisma.trackedSample.update({
      where: { id },
      data: {
        currentStatus: reason,
        testName: "Not Found"
      }
    });

    await prisma.statusHistory.create({
      data: {
        sampleId: id,
        status: reason
      }
    });

    return { success: true, sample: updated };
  } catch (error) {
    console.error("markCheckFailed error:", error);
    return { success: false, message: "Database error" };
  }
}