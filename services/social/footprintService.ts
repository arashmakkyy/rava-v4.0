
import { supabase } from '../supabaseClient';
import { Footprint } from '../../types';

export const footprintService = {
  /**
   * دریافت ردپاهای اطراف کاربر برای نمایش روی نقشه
   */
  async getNearby(lat: number, lng: number, radius: number = 2000): Promise<Footprint[]> {
    const { data, error } = await supabase.rpc('get_nearby_footprints', {
      px_lat: lat,
      px_lng: lng,
      px_radius: radius
    });

    if (error) {
      console.error("Footprint RPC Error:", error);
      return [];
    }

    return (data || []).map((f: any) => ({
      id: f.id,
      text: f.content,
      user: f.user_name,
      date: new Date(f.created_at).toLocaleDateString('fa-IR'),
      lat: f.lat,
      lng: f.lng,
      is_verified: f.is_verified !== false,
    }));
  },

  /**
   * ثبت یک ردپای جدید روی نقشه
   */
  async postFootprint(content: string, lat: number, lng: number): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase.from('footprints').insert({
        user_id: user.id,
        content,
        location: `POINT(${lng} ${lat})`,
        is_verified: false // نیاز به تایید AI در پس‌زمینه
      });

      return !error;
    } catch {
      return false;
    }
  }
};
