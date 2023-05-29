export const config = {
  runtime: "edge",
};

export default (request, response) => {
  response.json(request);
};
