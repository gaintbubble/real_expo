import { NextResponse } from 'next/server';
import { saveBarcodeToDatabase } from '../../actions';

export async function POST(request: Request) {
  try {
    const { barcode, activeTab } = await request.json();
    if (!barcode) {
      return NextResponse.json({ success: false, message: "Barcode is required" }, { status: 400 });
    }
    
    const response = await saveBarcodeToDatabase(barcode, activeTab);
    return NextResponse.json(response);
  } catch (error) {
    console.error("API route error:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
