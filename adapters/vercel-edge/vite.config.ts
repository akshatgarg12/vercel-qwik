import { vercelEdgeAdapter } from "../../fake_modules/qwik-city/adapters/vercel/vite";
import { extendConfig } from "@builder.io/qwik-city/vite";
import baseConfig from "../../vite.config";

export default extendConfig(baseConfig, () => {
  return {
    build: {
      ssr: true,
      rollupOptions: {
        input: [
          "src/entry.vercel-edge.tsx",
          "src/entry.vercel-serverless.tsx",
          "@qwik-city-plan",
        ],
      },
      outDir: ".vercel/output/functions/_qwik-city.func",
    },
    plugins: [
      vercelEdgeAdapter({
        vcConfigEntryPoint: "entry.vercel-serverless.js",
        vcConfigType: "serverless",
      }),
    ],
  };
});
