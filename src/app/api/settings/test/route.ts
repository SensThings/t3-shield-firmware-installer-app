import { NextRequest, NextResponse } from 'next/server';
import { testConnection } from '@/lib/ssh';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { host, username, password } = body as {
      host: string;
      username: string;
      password: string;
    };

    if (!host || !username || !password) {
      return NextResponse.json(
        { success: false, message: 'Host, username, and password are required' },
        { status: 400 }
      );
    }

    const result = await testConnection({ host, username, password });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
