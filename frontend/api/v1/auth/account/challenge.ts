import gateway from "../[purpose]/challenge";

export default {
  fetch(request: Request): Promise<Response> {
    return gateway.fetch(request);
  },
};
