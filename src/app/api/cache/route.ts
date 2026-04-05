import { NextResponse } from 'next/server';
import { getCacheStatus, clearFirmwareCache } from '@/lib/offline-assets';

export async function GET() {
  try {
    const status = getCacheStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    clearFirmwareCache();
    return NextResponse.json({ success: true, message: 'Firmware cache cleared' });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
