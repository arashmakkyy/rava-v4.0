
import { supabase } from '../supabaseClient';

export const edgeService = {
  /**
   * ارسال تصویر برای پردازش OCR در سمت سرور (امن و دقیق)
   */
  async processTicket(imagePath: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("User not authenticated");

    const { data, error } = await supabase.functions.invoke('process-ticket', {
      body: { imagePath, userId: user.id }
    });

    if (error) throw error;
    return data;
  },
};
