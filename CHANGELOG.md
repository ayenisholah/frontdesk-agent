# Changelog

## [0.2.0](https://github.com/ayenisholah/frontdesk-agent/compare/v0.1.0...v0.2.0) (2026-11-06)


### Features

* **agent:** add fictional chat CLI and deterministic scenario gate ([b22edd4](https://github.com/ayenisholah/frontdesk-agent/commit/b22edd427b4f76d51297e2b0be6fdc4c88f507fe))
* **agent:** add scoped business tools with replay-safe mutations ([795d198](https://github.com/ayenisholah/frontdesk-agent/commit/795d198ee0fb43f2e21cf30bd4f520bd640e745d))
* **agent:** add the agent loop and tool registry ([2a8f30c](https://github.com/ayenisholah/frontdesk-agent/commit/2a8f30c66c8d1792ea79fcfcc4d8f38029970c78))
* **agent:** add the Bedrock Converse client ([f44163d](https://github.com/ayenisholah/frontdesk-agent/commit/f44163d447802892f227570deea127b1b5d5c63c))
* **agent:** orchestrate guarded conversations with durable trace hooks ([db44617](https://github.com/ayenisholah/frontdesk-agent/commit/db44617fdc37c2ad925330b00e099b0eda4e9e61))
* **agent:** validate EU runtime configuration and bound provider failures ([16d4238](https://github.com/ayenisholah/frontdesk-agent/commit/16d4238337fcd1095a4c385c2c36e2d141b2cf9d))
* **api:** add health endpoints and environment validation ([b9b9cba](https://github.com/ayenisholah/frontdesk-agent/commit/b9b9cba1650778fb8dba112543fa1ccca4ae1c9c))
* **api:** add Postgres and Redis readiness checks ([b911ce3](https://github.com/ayenisholah/frontdesk-agent/commit/b911ce317a30d1e0e7a5f23af9bc21b5941556e9))
* **api:** add server entrypoint with graceful shutdown ([c64dae5](https://github.com/ayenisholah/frontdesk-agent/commit/c64dae5dd1116f6742e69968e263c846b7054f67))
* **api:** add structured JSON logger ([7bb969b](https://github.com/ayenisholah/frontdesk-agent/commit/7bb969b3d5f84f1cdff679adea9f95675f46b43c))
* **channels:** persist verified WhatsApp intake ([4776f68](https://github.com/ayenisholah/frontdesk-agent/commit/4776f68ae60d4c185ec88cdf7c2e24b4a30d6636))
* **core:** add availability engine ([2988fde](https://github.com/ayenisholah/frontdesk-agent/commit/2988fded3a8bff4eeeb5cb2dc8865195ce114fc8))
* **core:** add booking change policy ([c79ab52](https://github.com/ayenisholah/frontdesk-agent/commit/c79ab528926923886aa23c84d2d605bf7569089e))
* **core:** add business config schema and fixture ([9930344](https://github.com/ayenisholah/frontdesk-agent/commit/99303448b8dcf090c553f71bc46abb4490f8f49f))
* **core:** add phone number normalisation ([fe14eed](https://github.com/ayenisholah/frontdesk-agent/commit/fe14eedccf4d6d86ea3ed62ec2bb2fb85100e9f0))
* **core:** add time zone conversion ([815b36d](https://github.com/ayenisholah/frontdesk-agent/commit/815b36d3463a4896bf37c3389cf42ba77c76e517))
* **dashboard:** add component and pattern styles ([ce13530](https://github.com/ayenisholah/frontdesk-agent/commit/ce13530336ec55ea94e7277c528a91589bf0e395))
* **dashboard:** add reset, base, layout and utility styles ([dc222d8](https://github.com/ayenisholah/frontdesk-agent/commit/dc222d895e3b329310c2769e101b2ac4f43e15a1))
* **db:** add booking lanes and slot constraints ([54cf035](https://github.com/ayenisholah/frontdesk-agent/commit/54cf03560bf33b040b9a831623e4f71c19951d82))
* **db:** add cancel and reschedule ([2493805](https://github.com/ayenisholah/frontdesk-agent/commit/249380526cb5ec3a7b97efbabbef47ae421a09f1))
* **db:** add idempotent seed ([09a1f3e](https://github.com/ayenisholah/frontdesk-agent/commit/09a1f3ef8d1b7fbd9bde33e68d98f2395e19607e))
* **db:** add Prisma data model and initial migration ([927898d](https://github.com/ayenisholah/frontdesk-agent/commit/927898d0687e03888425989697679a522270b0e5))
* **db:** persist agent runs usage and conversation state ([6af0de8](https://github.com/ayenisholah/frontdesk-agent/commit/6af0de8f50db51d0bd286cb7141b521dd747d7d0))
* **db:** persist and load business config ([63e45c1](https://github.com/ayenisholah/frontdesk-agent/commit/63e45c14f84aa6c5cdd1b68efa5017dcb47f7817))
* **design:** add contrast and unit audits ([773e174](https://github.com/ayenisholah/frontdesk-agent/commit/773e174088f56c3f18ed7cd2dbac1f0f3d97d81b))
* **design:** add design tokens and CSS generator ([986c35c](https://github.com/ayenisholah/frontdesk-agent/commit/986c35c69a178ae481a8cc804caefcc49b3c1c00))
* **infra:** add isolated pilot network and ECS cluster ([8e0a560](https://github.com/ayenisholah/frontdesk-agent/commit/8e0a56093f5f3e2659f8c68b0e88b6d433e93154))
* **infra:** add offline CDK validation and image repositories ([f9faed1](https://github.com/ayenisholah/frontdesk-agent/commit/f9faed11f7b1dd45273156d06de4febb54767baf))
* **infra:** add protected Postgres and Redis pilot services ([aecc8c3](https://github.com/ayenisholah/frontdesk-agent/commit/aecc8c3fe687cc8d9bac66be4c063eb634e37661))
* **infra:** wire private runtime services and migration preparation ([9e22525](https://github.com/ayenisholah/frontdesk-agent/commit/9e22525b0eb4d23dc0ebadf5fff21a651a31490f))
* **privacy:** redact expired content and fence queued work ([6e8b35f](https://github.com/ayenisholah/frontdesk-agent/commit/6e8b35f34e68f77316d7b7f269f322d03a4e91d4))
* **whatsapp:** add durable delivery and uncertainty recovery ([5150fbc](https://github.com/ayenisholah/frontdesk-agent/commit/5150fbc187646edd23622b91c5a113bfd0cc4e9c))
* **worker:** add durable inbox dispatch and leases ([4a8da79](https://github.com/ayenisholah/frontdesk-agent/commit/4a8da7940b3c89152fb63af1f7b7e3aead0af29a))
* **worker:** fence agent turns and persist replies atomically ([d158ce4](https://github.com/ayenisholah/frontdesk-agent/commit/d158ce4a2f1e8a4d53cd40727e14522296f3fc1c))
* **worker:** run durable messaging and scheduled retention ([190f708](https://github.com/ayenisholah/frontdesk-agent/commit/190f7080a0163098121318d0e61ff4bbd020d201))


### Bug Fixes

* **agent:** attach CLI input after sandbox initialization ([4c4601c](https://github.com/ayenisholah/frontdesk-agent/commit/4c4601c6b63876ab683c3753dc10a014dc7ca5a5))
* **agent:** retain usage from rejected model completions ([e8aec8d](https://github.com/ayenisholah/frontdesk-agent/commit/e8aec8ded5d784796b26cb52ba56a451626cf13b))
* **api:** limit webhook requests and escape challenges ([648f385](https://github.com/ayenisholah/frontdesk-agent/commit/648f385f41e517012fa104716deb4dd554c52dbd))
* **core:** refuse times that only fall near a slot ([9ba64b3](https://github.com/ayenisholah/frontdesk-agent/commit/9ba64b3ff29b6004a8e96822c41126b87af68559))
* **db:** release unpaid bookings and revalidate every claim under the lock ([9e44540](https://github.com/ayenisholah/frontdesk-agent/commit/9e44540b9d4561830e7dd924d7224e91b8f25009))
