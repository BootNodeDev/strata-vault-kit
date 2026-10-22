# math test

A top-level fence, escaped underscore:

```math
\text{a\_b} = 1
```

B top-level fence, double backslash:

```math
\text{a\\_b} = 1
```

C top-level dollar block:

$$\text{a\_b} = 1$$

D inline-backtick form alone on a line:

$`\text{a\_b} = 1`$

E fence with mathrm:

```math
\mathrm{a\_b} = 1
```

F fence with textunderscore:

```math
\text{a\textunderscore b} = 1
```

G fence with plain spaces:

```math
\text{a b} = 1
```

H fence without text wrapper:

```math
a\_b = 1
```

- nested list fence escaped:
  ```math
  \text{a\_b} = 1
  ```
- nested list fence textunderscore:
  ```math
  \text{a\textunderscore b} = 1
  ```
- nested list inline form:
  $`\text{a\_b} = 1`$
