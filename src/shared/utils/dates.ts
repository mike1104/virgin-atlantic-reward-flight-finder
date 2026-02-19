import { YearMonth } from "../types";

export function getNext12Months(): YearMonth[] {
  const result: YearMonth[] = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear());
    result.push({ month, year });
  }

  return result;
}
