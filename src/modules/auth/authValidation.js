import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email()
      .refine(
        (email) => {
          const lower = email.toLowerCase();
          return lower.endsWith('@uni.edu') || lower.endsWith('@st.uni.edu');
        },
        'Email must end with @uni.edu or @st.uni.edu'
      ),
    password: z.string().min(1),
  }),
});
