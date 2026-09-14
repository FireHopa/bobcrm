import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("whatsapp-web.js is isolated as a backend runtime dependency", () => {
  const runtimePackage = JSON.parse(read("server/whatsapp-runtime/package.json"));
  const rootPackage = JSON.parse(read("package.json"));
  assert.equal(runtimePackage.dependencies["whatsapp-web.js"], "1.34.7");
  assert.equal(runtimePackage.dependencies.qrcode, "1.5.4");
  assert.match(rootPackage.scripts["install:whatsapp-runtime"], /server\/whatsapp-runtime/);
});

test("server restores consultant sessions and isolates regular users while admins can target connected sessions", () => {
  const index = read("server/index.js");
  const runtime = read("server/whatsappRuntime.js");
  const roles = read("server/rolePolicy.js");
  assert.match(index, /createWhatsappRuntime/);
  assert.match(index, /onInboundLeadCandidate: processWhatsappInboundLeadCandidate/);
  assert.match(index, /onResolvedLidIdentity: repairWhatsappLidLeadPhone/);
  assert.match(index, /await whatsappRuntime\.start\(\)/);
  assert.match(index, /pathname\.startsWith\("\/api\/whatsapp"\)/);
  assert.match(index, /requirePermission\(currentUser, "use_whatsapp"\)/);
  assert.match(index, /\/api\/whatsapp\/accounts/);
  assert.match(index, /requirePermission\(currentUser, "access_all_whatsapp"\)/);
  assert.match(index, /resolveWhatsappAccountUserIdForRequest/);
  assert.match(index, /whatsappRuntime\.getStatus\(accountUserId\)/);
  assert.match(index, /whatsappRuntime\.sendMessage\(accountUserId, body\)/);
  assert.match(index, /wa\.enabled = 1/);
  assert.match(index, /u\.role IN \('consultor_vendas', 'vendedor'\)/);
  assert.match(runtime, /async listAccounts\(\)/);
  assert.match(runtime, /new wa\.LocalAuth\(\{ clientId, dataPath: sessionRoot/);
  assert.match(runtime, /client\.on\("message"/);
  assert.match(runtime, /isEligibleInboundLeadMessage/);
  assert.match(runtime, /getContactLidAndPhone/);
  assert.match(runtime, /inboundWhatsappIdentityIds/);
  assert.match(runtime, /lead_pipeline_id/);
  assert.match(runtime, /phoneFromWhatsappCandidate/);
  assert.match(roles, /"access_all_whatsapp"/);
  assert.match(index, /path\.resolve\(projectRoot, WHATSAPP_SESSION_DIR_SETTING\)/);
});

test("inbound automation is idempotent and preserves any existing lead owner", () => {
  const index = read("server/index.js");
  const body = index.slice(index.indexOf("async function processWhatsappInboundLeadCandidate"), index.indexOf("function hashPassword"));
  assert.match(body, /whatsapp_inbound_events/);
  assert.match(body, /phoneKeyVariants\(phoneKey\)/);
  assert.match(body, /SELECT \* FROM leads/);
  assert.match(body, /outcome = 'existing'/);
  assert.match(body, /source: "WhatsApp"/);
  assert.match(body, /responsibleUserId: actor\.id/);
  assert.match(body, /resolveWhatsappInboundLeadTarget/);
  assert.match(body, /pipelineId: leadTarget\?\.pipelineId/);
  assert.doesNotMatch(body, /UPDATE leads SET responsible/);
});

test("frontend provides QR, images, microphone audio and received audio playback", () => {
  const app = read("src/App.tsx");
  const workspace = read("src/components/WhatsappWorkspace.tsx");
  const security = read("server/security.js");
  assert.match(app, /id: "whatsapp"/);
  assert.match(app, /hasPermission\(currentUser, "use_whatsapp"\)/);
  assert.match(workspace, /status\.qrCodeDataUrl/);
  assert.match(workspace, /sendWhatsappImage/);
  assert.match(workspace, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(workspace, /sendWhatsappAudio/);
  assert.match(workspace, /fetchWhatsappLeadRouting/);
  assert.match(workspace, /updateWhatsappLeadRouting/);
  assert.match(workspace, /fetchWhatsappAccounts/);
  assert.match(workspace, /access_all_whatsapp/);
  assert.match(workspace, /WhatsApps da equipe/);
  assert.match(workspace, /accountUserId/);
  assert.match(workspace, /Destino de novos leads/);
  assert.match(workspace, /<audio[^>]+controls/);
  assert.match(security, /microphone=\(self\)/);
  assert.match(security, /media-src 'self' data: blob:/);
});
