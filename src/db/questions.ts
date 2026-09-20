import { db } from './index.ts';
import { questions } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function upsertQuestionToDb(data: any) {
  try {
    const result = await db.insert(questions).values({
      questionId: data.id || data.questionId,
      companyId: data.company_id || data.companyId,
      companyName: data.company_name || data.companyName || '',
      role: data.role || 'Software Engineer',
      level: data.level || 'mid',
      type: data.type || 'technical',
      q: data.q || '',
      keywords: data.keywords || [],
      expectedAnswer: data.expected_answer || data.expectedAnswer || '',
      keyPoints: data.key_points || data.keyPoints || [],
      genuine: data.genuine !== false,
    }).onConflictDoUpdate({
      target: questions.questionId,
      set: {
        expectedAnswer: data.expected_answer || data.expectedAnswer || '',
        keyPoints: data.key_points || data.keyPoints || [],
        keywords: data.keywords || [],
      }
    }).returning();
    return result[0];
  } catch (error) {
    console.error("Failed to upsert question to Cloud SQL:", error);
    throw new Error("Failed to upsert question to database.", { cause: error });
  }
}

export async function getQuestionsFromDb(companyId?: string) {
  try {
    if (companyId) {
      return await db.select().from(questions).where(eq(questions.companyId, companyId));
    }
    return await db.select().from(questions);
  } catch (error) {
    console.error("Failed to fetch questions from Cloud SQL:", error);
    throw new Error("Failed to fetch questions from database.", { cause: error });
  }
}
