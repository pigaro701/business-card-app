// Supabase를 깨어있게 유지하는 ping 엔드포인트
// UptimeRobot이 5분마다 이 URL을 호출 → Supabase 자동 활성화 유지

const SUPABASE_URL = 'https://hxdthhktaoxkelxtuhzb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RJi9bcH4o7GDyDBj0WJWtg_d2WwNDpn';

export default async function handler(req, res) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/business_cards?select=id&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    const now = new Date().toISOString();
    res.status(200).json({
      status: 'ok',
      supabase: response.status === 200 ? 'awake' : `status_${response.status}`,
      pinged_at: now
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
}
