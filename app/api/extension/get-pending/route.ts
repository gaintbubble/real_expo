import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const samples = await prisma.trackedSample.findMany({
      where: {
        isCompleted: false,
        NOT: {
          OR: [
            { currentStatus: { contains: 'collected', mode: 'insensitive' } },
            { currentStatus: { contains: 'batch generated', mode: 'insensitive' } }
          ]
        },
        AND: [
          {
            OR: [
              { expectedEndTime: null },
              { expectedEndTime: { gt: new Date() } }
            ]
          },
          {
            OR: [
              { patientName: '--' }, // Step 1: Immediate fetch of patient and test details
              { nextCheckTime: null },
              { nextCheckTime: { lte: new Date() } } // Step 2: Analyzer check gated by trigger delay
            ]
          },
          {
            OR: [
              { isProvisional: false },
              { provisionalExpiry: { lte: new Date() } }
            ]
          }
        ]
      },
      orderBy: { updatedAt: 'asc' },
      take: 1 
    });
    
    // Move to back of queue while preserving any active future trigger timer
    if (samples.length > 0) {
      const s = samples[0];
      const hasFutureTrigger = s.nextCheckTime && new Date(s.nextCheckTime).getTime() > Date.now();
      if (!hasFutureTrigger) {
        await prisma.trackedSample.update({
          where: { id: s.id },
          data: { nextCheckTime: new Date(Date.now() + 60000) }
        });
      }
    }

    const response = NextResponse.json({ success: true, samples });
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  } catch (error) {
    console.error("GET Pending API Error:", error);
    const response = NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
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