export const config = {
  runtime: "edge",
};

export default async (request) => {
  const req = await request.json();
  console.log(req);
  return new Response(req);
};
