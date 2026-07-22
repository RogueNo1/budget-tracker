import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_RULES } from '@budget-tracker/core';
import { db } from './client.js';
import { categories, categoryRules } from './schema.js';
import { sql } from 'drizzle-orm';

async function seed(): Promise<void> {
  // Idempotent: clear existing defaults (user_id IS NULL) and re-insert.
  // Safe to re-run; never touches user-owned rows (user_id NOT NULL).
  await db.execute(sql`DELETE FROM category_rules WHERE user_id IS NULL`);
  await db.execute(sql`DELETE FROM categories WHERE user_id IS NULL`);

  for (const c of DEFAULT_CATEGORIES) {
    await db.insert(categories).values({
      userId: null,
      parentId: null,
      name: c.name,
      color: c.color,
      slug: c.id,
    });
  }

  for (const r of DEFAULT_CATEGORY_RULES) {
    await db.insert(categoryRules).values({
      userId: null,
      pattern: r.pattern,
      categoryId: r.categoryId,
      priority: r.priority,
    });
  }

  console.log(`Seeded ${DEFAULT_CATEGORIES.length} categories and ${DEFAULT_CATEGORY_RULES.length} rules.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
