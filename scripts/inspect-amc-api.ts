import { inspectOfficialAmcApi } from "../src/amc/client.js";
import { loadConfig } from "../src/config.js";

const snapshot = await inspectOfficialAmcApi(loadConfig(process.env));

console.log(
  JSON.stringify(
    {
      httpStatus: snapshot.httpStatus,
      theatre: snapshot.theatre,
      candidateCount: snapshot.candidateCount,
      matchingCount: snapshot.screenings.length,
      dateSpan: snapshot.dateSpan,
      matches: snapshot.screenings.map((screening) => ({
        id: screening.id,
        startsAt: screening.startsAt,
        availability: screening.availability,
        bookingPath: screening.bookingUrl ? new URL(screening.bookingUrl).pathname : "",
      })),
    },
    null,
    2,
  ),
);
