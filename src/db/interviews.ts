import { db } from './index.ts';
import { interviews } from './schema.ts';
import { eq, desc } from 'drizzle-orm';

export async function saveInterviewToDb(data: any) {
  try {
    const interviewId = data.id || `iv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = await db.insert(interviews).values({
      interviewId,
      userId: data.user_id || 'default_user',
      companyId: data.company_id || '',
      companyName: data.company_name || '',
      role: data.role || '',
      level: data.level || '',
      persona: data.persona || '',
      format: data.format || '',
      language: data.language || 'english',
      overallScore: data.overall_score || 0,
      breakdown: data.breakdown || {},
      proctoringSummary: data.proctoring_summary || {},
      qaHistory: data.qa_history || [],
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
    }).onConflictDoUpdate({
      target: interviews.interviewId,
      set: {
        overallScore: data.overall_score || 0,
        breakdown: data.breakdown || {},
        proctoringSummary: data.proctoring_summary || {},
        qaHistory: data.qa_history || [],
      }
    }).returning();
    return result[0];
  } catch (error) {
    console.error("Failed to save interview to Cloud SQL:", error);
    throw new Error("Failed to save interview to database.", { cause: error });
  }
}

export async function getInterviewsFromDb(userId?: string) {
  try {
    if (userId && userId !== 'all') {
      return await db.select().from(interviews).where(eq(interviews.userId, userId)).orderBy(desc(interviews.createdAt));
    }
    return await db.select().from(interviews).orderBy(desc(interviews.createdAt));
  } catch (error) {
    console.error("Failed to fetch interviews from Cloud SQL:", error);
    throw new Error("Failed to fetch interviews from database.", { cause: error });
  }
}
