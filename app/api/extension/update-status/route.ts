import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    
    let receivedTimeValue = undefined;
    if (data.receivedTime) {
      const parsedDate = new Date(data.receivedTime);
      if (!isNaN(parsedDate.getTime())) {
        receivedTimeValue = parsedDate;
      }
    }
    let resultTimeValue = undefined;
    if (data.resultTime) {
      const parsedResultDate = new Date(data.resultTime);
      if (!isNaN(parsedResultDate.getTime())) {
        resultTimeValue = parsedResultDate;
      }
    }
    const existingSample = await prisma.trackedSample.findUnique({
      where: { barcode: data.barcode }
    });

    let intervalTime = 5;
    let intervalTimeVerified: number | null = null;
    let hasVerification = false;

    if (data.serviceCd) {
      const individualCds = data.serviceCd.split(',').map((cd: string) => cd.trim());
      const configs = await prisma.testConfig.findMany({
        where: { serviceCd: { in: individualCds } }
      });
      if (configs.length > 0) {
        intervalTime = Math.min(...configs.map(c => c.intervalTime || 5));
        const verifiedTimes = configs.map(c => c.intervalTimeVerified).filter(v => v !== null) as number[];
        if (verifiedTimes.length > 0) {
          hasVerification = true;
          intervalTimeVerified = Math.min(...verifiedTimes);
        }
      }
    }

    const s = data.status.toLowerCase();
    let hasPending = false;
    if (data.testDetails) {
      try {
        const newDetails = JSON.parse(data.testDetails);
        const oldDetails = existingSample?.testDetails ? JSON.parse(existingSample.testDetails) : [];
        
        const mergedDetails = newDetails.map((newT: any) => {
          const oldT = oldDetails.find((o: any) => o.name === newT.name);
          if (oldT) {
            return { ...newT, delayReason: oldT.delayReason, extraTime: oldT.extraTime };
          }
          return newT;
        });
        
        data.testDetails = JSON.stringify(mergedDetails);
        
        hasPending = mergedDetails.some((d: any) => {
          const ds = (d.status || '').toLowerCase();
          return !(ds.includes('approved') || ds.includes('verified') || ds.includes('completed') || ds.includes('done') || ds.includes('authorized') || ds.includes('dispatch'));
        });
      } catch (e) {
        hasPending = s.includes('received') || s.includes('pending') || s.includes('waiting') || s.includes('collected');
      }
    } else {
      hasPending = s.includes('received') || s.includes('pending') || s.includes('waiting') || s.includes('collected');
    }

    const isFinalVerified = !hasPending && (s.includes('verified') || s.includes('authorized') || s.includes('approved') || s.includes('dispatch'));
    const isResultDone = !hasPending && (s.includes('done') || s.includes('completed'));
    
    let isCompleted = false;
    let nextCheckTime: Date | null = null;
    let expectedEndTime: Date | null | undefined = undefined;
    let updateCheckTime = false;

    const statusChanged = !existingSample || existingSample.currentStatus !== data.status;

    if (hasVerification) {
      if (isFinalVerified) {
        isCompleted = true;
        nextCheckTime = null;
        updateCheckTime = true;
      } else if (isResultDone) {
        isCompleted = false;
        if (statusChanged) {
          const baseTime = resultTimeValue ? resultTimeValue.getTime() : Date.now();
          expectedEndTime = new Date(baseTime + (intervalTimeVerified || 5) * 60000);
          nextCheckTime = expectedEndTime.getTime() < Date.now() ? new Date(Date.now() + 60000) : expectedEndTime;
        } else {
          nextCheckTime = new Date(Date.now() + 60000); // 1 minute
        }
        updateCheckTime = true;
      } else if (s.includes('received')) {
        isCompleted = false;
        if (statusChanged) {
          const baseTime = receivedTimeValue ? receivedTimeValue.getTime() : Date.now();
          expectedEndTime = new Date(baseTime + intervalTime * 60000);
          nextCheckTime = expectedEndTime.getTime() < Date.now() ? new Date(Date.now() + 60000) : expectedEndTime;
        } else {
          nextCheckTime = new Date(Date.now() + 60000);
        }
        updateCheckTime = true;
      }
    } else {
      if (isFinalVerified || isResultDone) {
        isCompleted = true;
        nextCheckTime = null;
        updateCheckTime = true;
      } else if (s.includes('received')) {
        isCompleted = false;
        if (statusChanged) {
          const baseTime = receivedTimeValue ? receivedTimeValue.getTime() : Date.now();
          expectedEndTime = new Date(baseTime + intervalTime * 60000);
          nextCheckTime = expectedEndTime.getTime() < Date.now() ? new Date(Date.now() + 60000) : expectedEndTime;
        } else {
          nextCheckTime = new Date(Date.now() + 60000);
        }
        updateCheckTime = true;
      }
    }

    const updatedSample = await prisma.trackedSample.update({
      where: { barcode: data.barcode },
      data: {
        patientName: data.patientName !== "Unknown Patient" ? data.patientName : existingSample?.patientName || "--",
        testName: data.testName !== "Unknown Test" ? data.testName : existingSample?.testName || "Unknown Test",
        // @ts-ignore
        testDetails: data.testDetails && data.testDetails !== "[]" ? data.testDetails : existingSample?.testDetails,
        serviceCd: data.serviceCd ? data.serviceCd : existingSample?.serviceCd || null,
        currentStatus: data.status,
        ...(receivedTimeValue ? { receivedTime: receivedTimeValue } : {}),
        ...(resultTimeValue ? { resultTime: resultTimeValue } : {}),
        isCompleted: isCompleted,
        ...(updateCheckTime ? { nextCheckTime: nextCheckTime } : {}),
        ...(expectedEndTime !== undefined ? { expectedEndTime: expectedEndTime } : {})
      }
    });

    await prisma.statusHistory.create({
      data: {
        sampleId: updatedSample.id,
        status: data.status
      }
    });

    const response = NextResponse.json({ success: true, updatedSample });
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  } catch (error) {
    console.error("Update Status API Error:", error);
    const response = NextResponse.json({ success: false, error: "Update failed" }, { status: 500 });
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  }
}

export async function OPTIONS() {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}