import { request as h1Request } from "node:http";
import { connect } from "node:http2";

/* Docker HEALTHCHECK: exits 0 if the server answers /health with 200. */

const port = Number(process.env.PORT ?? 3940);
const fail = (): never => process.exit(1);
setTimeout(fail, 4_000).unref();

if (process.env.KILOMITA_SERVER_PROTOCOL === "h2c") {
  const session = connect(`http://127.0.0.1:${port}`);
  session.on("error", fail);
  const stream = session.request({ ":path": "/health" });
  stream.on("response", (headers) => {
    process.exit(headers[":status"] === 200 ? 0 : 1);
  });
  stream.on("error", fail);
  stream.end();
} else {
  const req = h1Request({ host: "127.0.0.1", port, path: "/health" }, (response) => {
    process.exit(response.statusCode === 200 ? 0 : 1);
  });
  req.on("error", fail);
  req.end();
}
