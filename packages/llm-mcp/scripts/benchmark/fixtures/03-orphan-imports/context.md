# Test project context

User formatting helpers. When removing a function, also remove any
imports that were only used by that function. The codec module is shared
infrastructure, so be careful which parts of it are still consumed.
