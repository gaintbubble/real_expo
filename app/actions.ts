"use server";

import prisma from './lib/prisma';
import { getISTStartAndEndOfDay } from './lib/dateUtils';

export async function saveBarcodeToDatabase(barcode: string, activeTab?: string) {
  try {
    const existing = await prisma.trackedSample.findUnique({
      where: { barcode: barcode }
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

    let triggerDelayMins = 0;
    if (activeDept) {
      if (activeDept.triggerTime != null && activeDept.triggerTime > 0) {
        triggerDelayMins = activeDept.triggerTime;
      } else if (activeDept.name.toLowerCase() === 'haematology') {
        triggerDelayMins = 2;
      }
    }

    if (triggerDelayMins <= 0 && effectiveDeptName.toLowerCase() === 'haematology') {
      triggerDelayMins = 2;
    }

    let defaultTestName = "Resolving...";
    let serviceCd = `DEPT:${activeDept ? activeDept.name : effectiveDeptName}`;
    let defaultTestDetails = [{
      name: defaultTestName,
      status: "Pending Check",
      serviceCd: undefined,
      intervalTime: 30,
      intervalTimeVerified: null,
      department: activeDept ? activeDept.name : effectiveDeptName
    }];

    // Delayed Check: The trigger timer strictly gates the background status check.
    // Trigger time is calculated from the exact scan time.
    const nextCheckTime = new Date(scanTime.getTime() + triggerDelayMins * 60000);

    const sample = await prisma.trackedSample.create({
      data: {
        barcode: barcode,
        currentStatus: "Pending Check", // Initial pre-check status while trigger timer counts down
        receivedTime: null,            // Result Entry SLA will start only when status transitions to Received
        testName: defaultTestName,     // Placeholder "Resolving..." (no hardcoded CBC)
        patientName: "--",
        serviceCd: serviceCd,
        testDetails: JSON.stringify(defaultTestDetails),
        createdAt: scanTime,          // Exact scan timestamp
        nextCheckTime: nextCheckTime   // Gated trigger delay for status check
      }
    });

    await prisma.statusHistory.create({
      data: {
        sampleId: sample.id,
        status: "Pending Check"
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

    const now = new Date();
    // Auto-transition samples whose trigger delay has expired from 'Pending Check' to 'Received'
    const expiredPending = samples.filter(s =>
      !s.isCompleted &&
      (s.currentStatus === 'Pending Check' || s.currentStatus === 'Scanned') &&
      s.nextCheckTime &&
      new Date(s.nextCheckTime) <= now
    );

    if (expiredPending.length > 0) {
      for (const exp of expiredPending) {
        const transTime = exp.nextCheckTime || now;
        await prisma.trackedSample.update({
          where: { id: exp.id },
          data: {
            currentStatus: 'Received',
            receivedTime: transTime
          }
        });
        await prisma.statusHistory.create({
          data: {
            sampleId: exp.id,
            status: 'Received',
            timestamp: transTime
          }
        });
        exp.currentStatus = 'Received';
        exp.receivedTime = transTime;
      }
    }

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
      if (s.serviceCd) {
        if (s.serviceCd.startsWith('DEPT:')) {
          const deptName = s.serviceCd.substring(5);
          if (!departments.includes(deptName)) {
            departments.push(deptName);
          }
          const deptData = deptMap.get(deptName.toLowerCase());
          if (deptData?.triggerTime != null && deptData.triggerTime < minTriggerTime) minTriggerTime = deptData.triggerTime;
          if (deptData?.provisionalTime != null && deptData.provisionalTime < minProvisionalTime) minProvisionalTime = deptData.provisionalTime;
        } else {
          const individualCds = s.serviceCd.split(',').map((cd: string) => cd.trim());
          const originalTestNames = s.testName.split(',').map((name: string) => name.trim());
          
          displayTestName = individualCds.map((cd: string, index: number) => {
            const mapped = configByServiceCd.get(cd.toLowerCase());
            if (mapped) {
              if (!departments.includes(mapped.department)) {
                departments.push(mapped.department);
              }
              if (mapped.triggerTime != null && mapped.triggerTime < minTriggerTime) minTriggerTime = mapped.triggerTime;
              if (mapped.provisionalTime != null && mapped.provisionalTime < minProvisionalTime) minProvisionalTime = mapped.provisionalTime;
              if (mapped.intervalTime != null && mapped.intervalTime < minIntervalTime) minIntervalTime = mapped.intervalTime;
              if (mapped.intervalTimeVerified != null && mapped.intervalTimeVerified < minIntervalTimeVerified) minIntervalTimeVerified = mapped.intervalTimeVerified;
              
              return mapped.name;
            }
            return originalTestNames[index] || cd;
          }).join(', ');
        }
      }

      if (departments.length === 0 && s.testName) {
        const mappedByName = configByName.get(s.testName.toLowerCase().trim());
        if (mappedByName) {
          if (mappedByName.department && !departments.includes(mappedByName.department)) {
            departments.push(mappedByName.department);
          }
          if (mappedByName.triggerTime != null && mappedByName.triggerTime < minTriggerTime) minTriggerTime = mappedByName.triggerTime;
          if (mappedByName.provisionalTime != null && mappedByName.provisionalTime < minProvisionalTime) minProvisionalTime = mappedByName.provisionalTime;
        }
      }

      // Fallback: If minTriggerTime is not set from configs, deduce from nextCheckTime & createdAt
      if (minTriggerTime === Infinity && s.nextCheckTime && s.createdAt) {
        const diffMins = Math.round((new Date(s.nextCheckTime).getTime() - new Date(s.createdAt).getTime()) / 60000);
        if (diffMins > 0) {
          minTriggerTime = diffMins;
        }
      }
      if (minTriggerTime === Infinity && departments.includes('HAEMATOLOGY')) {
        minTriggerTime = 2;
      }

      return {
        ...s,
        displayTestName,
        testDetails: JSON.stringify(enhancedTestDetails),
        departments,
        triggerTime: minTriggerTime === Infinity ? null : minTriggerTime,
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

export async function markSampleReceived(id: string) {
  try {
    const existingSample = await prisma.trackedSample.findUnique({ where: { id } });
    if (!existingSample) return { success: false, message: "Sample not found" };

    let intervalTime = 5; // default
    if (existingSample.serviceCd) {
      const individualCds = existingSample.serviceCd.split(',').map((cd: string) => cd.trim());
      const configs = await prisma.testConfig.findMany({
        where: { serviceCd: { in: individualCds } }
      });
      if (configs.length > 0) {
        intervalTime = Math.min(...configs.map(c => c.intervalTime || 5));
      }
    }

    const nextCheckTime = new Date(Date.now() + intervalTime * 60000);

    const sample = await prisma.trackedSample.update({
      where: { id },
      data: { 
        currentStatus: "Sample Received",
        receivedTime: new Date(),
        nextCheckTime: nextCheckTime,
        expectedEndTime: nextCheckTime
      }
    });

    await prisma.statusHistory.create({
      data: {
        status: "Sample Received",
        sampleId: id
      }
    });

    return { success: true, sample };
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

export async function simulateFalseTrigger(id: string, type: 'trigger' | 'result' | 'verification') {
  try {
    const existingSample = await prisma.trackedSample.findUnique({ where: { id } });
    if (!existingSample) return { success: false, message: "Sample not found" };

    const updateData: any = {};

    if (type === 'trigger') {
      updateData.currentStatus = "Sample Received";
      updateData.receivedTime = new Date();
      if (existingSample.testDetails) {
         try {
           const details = JSON.parse(existingSample.testDetails);
           const newDetails = details.map((t: any) => ({ ...t, status: 'Sample Received' }));
           updateData.testDetails = JSON.stringify(newDetails);
         } catch(e) {}
      }
    } else if (type === 'result') {
      updateData.currentStatus = "Result Done"; 
      updateData.resultTime = new Date();
      if (existingSample.testDetails) {
         try {
           const details = JSON.parse(existingSample.testDetails);
           const newDetails = details.map((t: any) => ({ ...t, status: 'Result Done' }));
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
        sampleId: id
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