/** Run the weather monitor once (same code path as the scheduler, without the slot lock). */
import { runMonitor } from "@/lib/monitor";
runMonitor({ force: true }).then((s) => console.log(JSON.stringify(s))).catch((e) => { console.error(e); process.exit(1); });
