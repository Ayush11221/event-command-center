import gateway from "../[purpose]/challenge.js";

export default {
  fetch(request: Request): Promise<Response> {
    return gateway.fetch(request);
  },
};
