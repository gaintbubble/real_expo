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
              { nextCheckTime: null },
              { nextCheckTime: { lte: new Date() } }
            ]
          }
        ]
      },
      orderBy: { updatedAt: 'asc' },
      take: 1 
    });
    
    // Touch the record so it moves to the back of the queue, preventing it from getting stuck on one barcode
    if (samples.length > 0) {
      await prisma.trackedSample.update({
        where: { id: samples[0].id },
        data: { nextCheckTime: new Date() }
      });
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