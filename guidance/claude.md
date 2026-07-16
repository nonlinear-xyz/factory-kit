### Claude adapter

Use the compatibility commands `/standup`, `/entry`, `/submit`, `/close`, `/release`, `/setup-linear`, `/prompt`, and `/kit-audit` when their workflow is requested. Their command files are thin adapters over canonical skills.

The existing specialist names remain the public delegation interface. Each specialist preloads its matching canonical `factory-*` skill; do not duplicate the workflow in the adapter.
