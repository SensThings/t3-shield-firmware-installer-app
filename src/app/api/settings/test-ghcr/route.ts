import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, token, image } = body as {
      username: string;
      token: string;
      image: string;
    };

    if (!username || !token) {
      return NextResponse.json(
        { success: false, message: 'Username and token are required' },
        { status: 400 }
      );
    }

    const start = Date.now();

    // Test GHCR authentication by checking the token against the GitHub API
    const authResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!authResponse.ok) {
      return NextResponse.json({
        success: false,
        message: `Authentication failed (${authResponse.status}) — check token`,
        latencyMs: Date.now() - start,
      });
    }

    const userData = await authResponse.json();
    if (userData.login?.toLowerCase() !== username.toLowerCase()) {
      return NextResponse.json({
        success: false,
        message: `Token belongs to "${userData.login}", not "${username}"`,
        latencyMs: Date.now() - start,
      });
    }

    // Check if token has read:packages scope by trying to list packages
    // Parse image to get org/repo: ghcr.io/sensthings/t3shield-firmware:latest
    let imageCheckMsg = '';
    if (image) {
      const match = image.match(/ghcr\.io\/([^/]+)\/([^:]+)/);
      if (match) {
        const [, org, pkg] = match;
        const pkgResponse = await fetch(
          `https://api.github.com/orgs/${org}/packages/container/${pkg}/versions?per_page=1`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );
        if (pkgResponse.ok) {
          imageCheckMsg = `, image "${pkg}" accessible`;
        } else if (pkgResponse.status === 404) {
          // Try user packages instead of org
          const userPkgResponse = await fetch(
            `https://api.github.com/users/${org}/packages/container/${pkg}/versions?per_page=1`,
            {
              headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
              },
            }
          );
          if (userPkgResponse.ok) {
            imageCheckMsg = `, image "${pkg}" accessible`;
          } else {
            imageCheckMsg = `, but image "${pkg}" not found or no read:packages scope`;
          }
        } else {
          imageCheckMsg = `, but cannot verify image access (${pkgResponse.status})`;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Authenticated as ${userData.login}${imageCheckMsg}`,
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
