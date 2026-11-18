import { getUserId } from "./auth";
import { getDb, type Db } from "./db/client";

export type Context = {
  db: Db;
  userId: string;
  clock: () => number;
};

export async function createContext(): Promise<Context> {
  return {
    db: await getDb(),
    userId: getUserId(),
    clock: Date.now,
  };
}
