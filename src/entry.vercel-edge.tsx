/*
 * WHAT IS THIS FILE?
 *
 * It's the entry point for Vercel Edge when building for production.
 *
 * Learn more about the Vercel Edge integration here:
 * - https://qwik.builder.io/docs/deployments/vercel-edge/
 *
 */
import {
  createQwikCity,
  type PlatformVercel,
} from "@builder.io/qwik-city-new/middleware/vercel-edge";
import qwikCityPlan from "@qwik-city-plan";
import { manifest } from "@qwik-client-manifest";
import render from "./entry.ssr";

declare global {
  interface QwikCityPlatform extends PlatformVercel {}
}

const env = "edge";

export default createQwikCity({ render, qwikCityPlan, manifest, env });
