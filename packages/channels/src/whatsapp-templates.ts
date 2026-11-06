import { z } from "zod";
const selection = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
});
const settings = z.object({
  token: z.string().min(1),
  version: z.string().regex(/^v\d+\.\d+$/),
  wabaId: z.string().regex(/^\d+$/),
  owner: selection,
  customer: selection.optional(),
});
const response = z.object({ data: z.array(selection.extend({ status: z.string() })) });
type Selected = z.infer<typeof selection>;
type Verified = Selected & { verifiedAt: string };
export async function verifyWhatsAppTemplates(
  input: unknown,
  dependencies: { request: typeof fetch; clock: () => Date },
): Promise<{ owner: Verified; customer?: Verified }> {
  const parsed = settings.safeParse(input);
  if (!parsed.success) throw new Error("Invalid template configuration");
  const config = parsed.data;
  const verify = async (chosen: Selected): Promise<Verified> => {
    const query = new URLSearchParams({
      name: chosen.name,
      fields: "name,language,status",
      limit: "100",
    });
    try {
      const result = await dependencies.request(
        `https://graph.facebook.com/${config.version}/${config.wabaId}/message_templates?${query.toString()}`,
        {
          headers: { authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!result.ok) throw new Error("Unavailable");
      const body = response.parse(await result.json());
      if (
        !body.data.some(
          (entry) =>
            entry.name === chosen.name &&
            entry.language === chosen.language &&
            entry.status === "APPROVED",
        )
      )
        throw new Error("Unapproved");
      return { ...chosen, verifiedAt: dependencies.clock().toISOString() };
    } catch {
      throw new Error("Template verification failed");
    }
  };
  const owner = await verify(config.owner);
  return { owner, ...(config.customer ? { customer: await verify(config.customer) } : {}) };
}
