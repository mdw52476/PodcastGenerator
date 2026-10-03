// pnpm owner:add you@example.com
// Creates the owner's sign-in account (no password, no email sent) if needed and
// marks it as the studio owner, so the web app's database rules let it in.
import { db } from "./supabase";

const email = process.argv.slice(2).find((a) => a.includes("@"))?.trim().toLowerCase();
if (!email) {
  console.error("usage: pnpm owner:add <email>");
  process.exit(1);
}

const admin = db().auth.admin;
let userId: string | undefined;
for (let page = 1; !userId; page++) {
  const { data, error } = await admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}
if (!userId) {
  const { data, error } = await admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log(`created sign-in account for ${email}`);
} else console.log(`sign-in account for ${email} already exists`);

const { error } = await db().from("app_owners").upsert({ user_id: userId, email });
if (error) throw error;
console.log(`${email} is the studio owner`);
