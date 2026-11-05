# Changelog

## [0.2.0](https://github.com/ayenisholah/frontdesk-agent/compare/v0.1.0...v0.2.0) (2026-11-05)


### Features

* **api:** add health endpoints and environment validation ([b9b9cba](https://github.com/ayenisholah/frontdesk-agent/commit/b9b9cba1650778fb8dba112543fa1ccca4ae1c9c))
* **api:** add Postgres and Redis readiness checks ([b911ce3](https://github.com/ayenisholah/frontdesk-agent/commit/b911ce317a30d1e0e7a5f23af9bc21b5941556e9))
* **api:** add server entrypoint with graceful shutdown ([c64dae5](https://github.com/ayenisholah/frontdesk-agent/commit/c64dae5dd1116f6742e69968e263c846b7054f67))
* **api:** add structured JSON logger ([7bb969b](https://github.com/ayenisholah/frontdesk-agent/commit/7bb969b3d5f84f1cdff679adea9f95675f46b43c))
* **core:** add availability engine ([2988fde](https://github.com/ayenisholah/frontdesk-agent/commit/2988fded3a8bff4eeeb5cb2dc8865195ce114fc8))
* **core:** add business config schema and fixture ([9930344](https://github.com/ayenisholah/frontdesk-agent/commit/99303448b8dcf090c553f71bc46abb4490f8f49f))
* **core:** add phone number normalisation ([fe14eed](https://github.com/ayenisholah/frontdesk-agent/commit/fe14eedccf4d6d86ea3ed62ec2bb2fb85100e9f0))
* **core:** add time zone conversion ([815b36d](https://github.com/ayenisholah/frontdesk-agent/commit/815b36d3463a4896bf37c3389cf42ba77c76e517))
* **dashboard:** add component and pattern styles ([ce13530](https://github.com/ayenisholah/frontdesk-agent/commit/ce13530336ec55ea94e7277c528a91589bf0e395))
* **dashboard:** add reset, base, layout and utility styles ([dc222d8](https://github.com/ayenisholah/frontdesk-agent/commit/dc222d895e3b329310c2769e101b2ac4f43e15a1))
* **db:** add idempotent seed ([09a1f3e](https://github.com/ayenisholah/frontdesk-agent/commit/09a1f3ef8d1b7fbd9bde33e68d98f2395e19607e))
* **db:** add Prisma data model and initial migration ([927898d](https://github.com/ayenisholah/frontdesk-agent/commit/927898d0687e03888425989697679a522270b0e5))
* **db:** persist and load business config ([63e45c1](https://github.com/ayenisholah/frontdesk-agent/commit/63e45c14f84aa6c5cdd1b68efa5017dcb47f7817))
* **design:** add contrast and unit audits ([773e174](https://github.com/ayenisholah/frontdesk-agent/commit/773e174088f56c3f18ed7cd2dbac1f0f3d97d81b))
* **design:** add design tokens and CSS generator ([986c35c](https://github.com/ayenisholah/frontdesk-agent/commit/986c35c69a178ae481a8cc804caefcc49b3c1c00))


### Bug Fixes

* **core:** refuse times that only fall near a slot ([9ba64b3](https://github.com/ayenisholah/frontdesk-agent/commit/9ba64b3ff29b6004a8e96822c41126b87af68559))
