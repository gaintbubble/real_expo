import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();

    const samples = await prisma.trackedSample.findMany({
      where: {
        isCompleted: false,
        AND: [
          {
            OR: [
              { expectedEndTime: null },
              { expectedEndTime: { gt: now } }
            ]
          },
          {
            // Do NOT check status immediately upon scan.
            // Only start checking when trigger delay from scan time has elapsed (nextCheckTime <= now).
            OR: [
              { nextCheckTime: { lte: now } },
              { nextCheckTime: null }
            ]
          },
          {
            OR: [
              { isProvisional: false },
              { provisionalExpiry: { lte: now } }
            ]
          }
        ]
      },
      orderBy: { updatedAt: 'asc' },
      take: 1 
    });
    
    // In-memory guard: Never return sample if its trigger timer is still active
    const validSamples = samples.filter(s => {
      if (s.nextCheckTime && new Date(s.nextCheckTime).getTime() > Date.now()) {
        return false;
      }
      return true;
    });

    // Move to back of queue while background check occurs
    if (validSamples.length > 0) {
      const s = validSamples[0];
      await prisma.trackedSample.update({
        where: { id: s.id },
        data: {
          currentStatus: 'Checking...',
          nextCheckTime: new Date(Date.now() + 60000)
        }
      });
    }

    const response = NextResponse.json({ success: true, samples: validSamples });
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