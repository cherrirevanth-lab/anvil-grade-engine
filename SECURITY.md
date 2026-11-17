# Security

## Threat model

The untrusted input is learner code. It is executed in a child Node process, never in the host
process, and its result is reduced to a fixed object before it leaves `grade()`.

Mitigations in this repository:

- separate process, 256 MiB heap, wall-clock kill, 64 KiB output caps;
- the test file is read server-side and never returned; a test asserts that;
- load failures are reduced to an error **name**, so a stack trace cannot carry test text;
- no network calls, no dependencies, no environment secrets.

## Known limits

A child process is not a security boundary against a determined attacker. It does not block
filesystem reads, process spawning or sockets. Deploy behind a container with no egress, a
read-only root, a non-root uid, dropped capabilities and a 64-PID limit. Do not run this on a host
that holds credentials.

## Reporting

Open a private security advisory on the repository. Do not file a public issue with a working
escape.
