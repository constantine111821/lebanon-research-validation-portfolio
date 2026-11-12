import { json } from '@/lib/http';
import { supabaseConfig } from '@/lib/config';
export const dynamic = 'force-dynamic';
export function GET() {
  try {
    supabaseConfig();
    return json({status: 'CONFIGURED', commit: process.env.RVW_BUILD_COMMIT, backend_mode: process.env.RVW_BACKEND_MODE === 'hosted' ? 'hosted' : 'local', database_checked: false});
  } catch {
    return json({status: 'NOT_CONFIGURED', database_checked: false}, 503);
  }
}
