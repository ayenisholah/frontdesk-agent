import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("ships valid AWS RDS root certificates for strict database TLS verification", () => {
  const bundle = readFileSync(new URL("../../../certs/rds-eu-west-1.crt", import.meta.url), "utf8");
  const certificates = bundle.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  )!;
  expect(certificates).toHaveLength(3);
  for (const pem of certificates) {
    const certificate = new X509Certificate(pem);
    expect(certificate.ca).toBe(true);
    expect(certificate.subject).toContain("Amazon RDS eu-west-1");
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.now());
  }
});
