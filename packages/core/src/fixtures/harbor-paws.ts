// A fictional pet groomer used by the seed, the CLI harness and the evals.
// Shaped like a real small salon (baths and grooms by length, add-on single services,
// deposits only on long appointments) but every name and detail is invented.
import type { BusinessConfig } from "../config";

const weekday = (day: number, open: string, close: string) => ({ weekday: day, open, close });

export const harborPaws: BusinessConfig = {
  slug: "harbor-paws",
  name: "Harbor Paws Grooming",
  timezone: "America/Detroit",
  currency: "USD",
  services: [
    {
      id: "bath-short-coat",
      name: "Bath and brush (short coat)",
      durationMinutes: 60,
      priceCents: 4000,
      depositCents: 0,
    },
    {
      id: "groom-single-coat",
      name: "Full groom (single coat)",
      durationMinutes: 120,
      priceCents: 6500,
      depositCents: 1500,
    },
    {
      id: "groom-double-coat",
      name: "Full groom (double coat)",
      durationMinutes: 150,
      priceCents: 8000,
      depositCents: 2000,
    },
    { id: "nail-trim", name: "Nail trim", durationMinutes: 15, priceCents: 1000, depositCents: 0 },
    {
      id: "pads-and-nails",
      name: "Paw pads and nail trim",
      durationMinutes: 20,
      priceCents: 1500,
      depositCents: 0,
    },
    {
      id: "teeth-brushing",
      name: "Teeth brushing",
      durationMinutes: 15,
      priceCents: 1000,
      depositCents: 0,
    },
  ],
  openingHours: [
    weekday(1, "08:00", "17:00"),
    weekday(2, "08:00", "17:00"),
    weekday(3, "08:00", "17:00"),
    weekday(4, "08:00", "17:00"),
    weekday(5, "08:00", "17:00"),
    weekday(6, "08:00", "13:00"),
  ],
  capacity: 2,
  buffers: { beforeMinutes: 0, afterMinutes: 15 },
  cancellationWindowHours: 24,
  faq: [
    {
      question: "Are your prices final?",
      answer:
        "Listed prices are starting prices. The groomer confirms the final price at drop-off, based on size, coat condition and behaviour.",
    },
    {
      question: "Can you give my pet medication or sedatives?",
      answer: "No. We don't give medication or sedatives of any kind. Please ask your vet.",
    },
    {
      question: "Do you groom cats?",
      answer:
        "Yes, for baths, nail trims and teeth brushing. Ask us before booking a full cat groom.",
    },
    {
      question: "Do I need to show vaccination records?",
      answer: "Yes. Please bring proof of a current rabies vaccination to the first appointment.",
    },
  ],
  tone: {
    style: "friendly",
    notes: "Warm and brief. Use the pet's name when the customer gives it. No emojis.",
  },
};
