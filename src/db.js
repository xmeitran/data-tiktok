// Nap .env ngay tai day: moi entry point (server, npm run sync, dump-orders) deu di qua
// module nay, nen dat o day thi khong entry point nao chay thieu DATABASE_URL.
import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params);
