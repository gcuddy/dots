# Deliberate violations — every line here should trip a specific lint

A ==single word body==[^m-t1] trap.

[^m-t1]: #m/todo

An ==empty body==[^m-t2] trap.

[^m-t2]:

A ==shallow thread==[^m-t3] trap.

[^m-t3]: gus (2026-08-31): head is fine #m/q
  - claude: this reply is 2-space indented and silently detaches

A ==stacked inline==^[first]^[second] trap.

A ==spaced ref== [^m-t4] trap.

[^m-t4]: gus: the gap above should lint as mis-normalized, not point. #m/q

A ==duplicate label==[^m-t5] trap.

[^m-t5]: gus: first definition, a fine one #m/def
[^m-t5]: claude: duplicate definition, renderers disagree on the winner

A ==dangling ref==[^m-t6] trap — no definition anywhere.

[^m-t7]: gus: orphaned definition — no ref anywhere, invisible when rendered. #m/q

A ==bad metadata==[^m-t8] trap.

[^m-t8]: @gus says hi %%sync: 123%% — both carriers are wrong here.

An == inner whitespace ==[^m-t9] trap.
[^m-t9]: gus: also missing the blank line above this definition. #m/q

An undeclared ==shared label==[^m-t10] and again ==shared label==[^m-t10] trap.

[^m-t10]: gus: no multi declaration here — should warn about accidental reuse.

A ==sequential label==[^m-1] transient.

[^m-1]: gus: relabel me on save. #m/todo
