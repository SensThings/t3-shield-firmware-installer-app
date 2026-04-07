import { NextRequest, NextResponse } from 'next/server';
import { testConnection, connectViaProxy } from '@/lib/ssh';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { host, username, password, desktopIp, desktopSshUsername, desktopSshPassword } = body as {
      host: string;
      username: string;
      password: string;
      desktopIp?: string;
      desktopSshUsername?: string;
      desktopSshPassword?: string;
    };

    if (!host || !username || !password) {
      return NextResponse.json(
        { success: false, message: 'Host, username, and password are required' },
        { status: 400 }
      );
    }

    // If desktop IP is set, test via ProxyJump
    if (desktopIp && desktopSshUsername && desktopSshPassword) {
      const start = Date.now();
      try {
        const proxy = await connectViaProxy({
          jumpHost: desktopIp,
          jumpUsername: desktopSshUsername,
          jumpPassword: desktopSshPassword,
          targetHost: host,
          targetUsername: username,
          targetPassword: password,
          timeout: 10000,
        });
        const latencyMs = Date.now() - start;
        proxy.closeAll();
        return NextResponse.json({
          success: true,
          message: `Connected via ${desktopIp} (${latencyMs}ms)`,
          latencyMs,
        });
      } catch (err) {
        const latencyMs = Date.now() - start;
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message.includes('Tunnel')) {
          return NextResponse.json({ success: false, message: `Desktop connected but cannot reach device at ${host}`, latencyMs });
        }
        return NextResponse.json({ success: false, message, latencyMs });
      }
    }

    // Direct connection
    const result = await testConnection({ host, username, password });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
