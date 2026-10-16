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

    let nextCheckTime = new Date();
    let serviceCd = undefined;
    
    if (activeTab) {
      serviceCd = `DEPT:${activeTab}`;
    }

    const sample = await prisma.trackedSample.create({
      data: {
        barcode: barcode,
        currentStatus: "Pending LIS Search",
        testName: "Waiting...",
        patientName: "--",
        serviceCd: serviceCd,
        nextCheckTime: nextCheckTime
      }
    });

    return { success: true, sample };
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
    const deptMap = new Map(departmentsList.map(d => [d.name, { triggerTime: d.triggerTime, provisionalTime: d.provisionalTime }]));

    const serviceCds = samples.map(s => s.serviceCd).filter(Boolean) as string[];
    const uniqueServiceCds = Array.from(new Set(
      serviceCds.flatMap(cdList => cdList.split(',').map(cd => cd.trim()))
    ));
    
    let configMap = new Map<string, { name: string, department: string, triggerTime: number | null, provisionalTime: number | null, intervalTime: number | null, intervalTimeVerified: number | null }>();
    if (uniqueServiceCds.length > 0) {
      const configs = await prisma.testConfig.findMany({
        where: {
          serviceCd: { in: uniqueServiceCds }
        },
        include: { department: true }
      });
      configMap = new Map(configs.map(c => [
        c.serviceCd as string, 
        { 
          name: c.shortName || c.testName, 
          department: c.department.name,
          triggerTime: c.department.triggerTime,
          provisionalTime: c.department.provisionalTime,
          intervalTime: c.intervalTime,
          intervalTimeVerified: c.intervalTimeVerified
        }
      ]));
    }

    return samples.map(s => {
      let minTriggerTime = Infinity;
      let minProvisionalTime = Infinity;
      let minIntervalTime = Infinity;
      let minIntervalTimeVerified = Infinity;

      let displayTestName = s.testName;
      let departments: string[] = [];
      if (s.serviceCd) {
        if (s.serviceCd.startsWith('DEPT:')) {
          const deptName = s.serviceCd.substring(5);
          departments.push(deptName);
          const deptData = deptMap.get(deptName);
          if (deptData?.triggerTime != null && deptData.triggerTime < minTriggerTime) minTriggerTime = deptData.triggerTime;
          if (deptData?.provisionalTime != null && deptData.provisionalTime < minProvisionalTime) minProvisionalTime = deptData.provisionalTime;
        } else {
          const individualCds = s.serviceCd.split(',').map(cd => cd.trim());
          const originalTestNames = s.testName.split(',').map(name => name.trim());
          
          const hasMapping = individualCds.some(cd => configMap.has(cd));
          if (hasMapping) {
            displayTestName = individualCds.map((cd, index) => {
              const mapped = configMap.get(cd);
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
      }
      return {
        ...s,
        displayTestName,
        departments,
        triggerTime: minTriggerTime === Infinity ? null : minTriggerTime,
        provisionalTime: minProvisionalTime === Infinity ? null : minProvisionalTime,
        intervalTime: minIntervalTime === Infinity ? null : minIntervalTime,
        intervalTimeVerified: minIntervalTimeVerified === Infinity ? null : minIntervalTimeVerified,
        isProvisional: Boolean(s.isProvisional),
        provisionalExpiry: s.provisionalExpiry ? s.provisionalExpiry.toISOString() : null,
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
    } else if (type === 'result') {
      updateData.currentStatus = "Result Done"; 
      updateData.resultTime = new Date();
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