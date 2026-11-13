/**
 * Dev only: seed a sample farmer (+ one spray task) into the DB at KS_DB_PATH so the UI can be
 * rendered without going through voice onboarding. Usage:
 *   KS_DB_PATH=./data/ui-test.db npx tsx scripts/seed-ui.ts [wheat|rice|onion] [daysSinceSowing]
 * Never point this at a real farmer's DB.
 */
import { createTask, resetAll, saveProfile, setSetting } from "@/lib/repo";
import { addDays, istDateKey } from "@/lib/time";
import type { CropId } from "@/lib/config";

const crop = (process.argv[2] ?? "wheat") as CropId;
const days = Number(process.argv[3] ?? 33);
const now = new Date();
const today = istDateKey(now);
resetAll();
saveProfile({
  language: "hi", crop, sowingDate: addDays(today, -days), landSize: 2, landUnit: "acre",
  placeQuery: "Kanpur", placeLabel: "Kanpur, Uttar Pradesh", lat: 26.45, lon: 80.33, irrigation: "tubewell",
  confirmedAt: now.toISOString(),
});
createTask({ type: "spray", plannedDate: addDays(today, 2), notes: "seed-ui" });
setSetting("lastCheckIn", now.toISOString());
console.log(`seeded ${crop} day ${days} → ${process.env.KS_DB_PATH}`);
