# Asymptotic analysis and Big-O notation

When we compare algorithms, we rarely care how many milliseconds they take on one machine. We care how their cost **grows** as the input gets larger. Asymptotic analysis gives us a vocabulary for that growth that ignores hardware, language, and small constant overheads.

## Counting steps, not seconds

Pick a basic operation, such as a comparison or an assignment, and count how many times the algorithm performs it for an input of size *n*.

```
sum = 0
for i in 0 .. n-1:
    sum = sum + a[i]
```

The loop body runs *n* times. Add a few setup steps and the total is something like `n + 2`. For large *n*, the `+ 2` stops mattering.

## What Big-O means

We say *f(n)* is **O(g(n))** if there are constants *c* > 0 and *n₀* such that

> f(n) ≤ c · g(n) for every n ≥ n₀

In words: past some point, *f* never grows faster than a constant multiple of *g*. Big-O is an **upper bound**. That is why an algorithm that is O(n) is also, technically, O(n²). The second statement is true, just less useful.

## Simplification rules

1. **Drop constant factors.** 3n and n/2 are both O(n).
2. **Drop lower-order terms.** n² + 5n + 100 is O(n²), because n² dominates.
3. **Add sequential steps, multiply nested ones.** A loop of *n* followed by another loop of *n* is O(n). A loop of *n* inside a loop of *n* is O(n²).

## Common growth rates

| Notation   | Name         | Typical example                         |
|------------|--------------|-----------------------------------------|
| O(1)       | Constant     | Reading an array element by index       |
| O(log n)   | Logarithmic  | Binary search on a sorted array         |
| O(n)       | Linear       | Scanning every element once             |
| O(n log n) | Linearithmic | Merge sort                              |
| O(n²)      | Quadratic    | Comparing every pair of elements        |
| O(2ⁿ)      | Exponential  | Trying every subset of a set            |

## Why binary search is logarithmic

Each comparison discards half of the remaining range. After *k* comparisons, at most n / 2ᵏ candidates remain. The search ends when that reaches 1, so k ≈ log₂ n. Doubling the input adds only **one** extra comparison.

## Why "every pair" is quadratic

With *n* items there are n(n − 1) / 2 distinct pairs. Expanding gives n²/2 − n/2. Drop the constant factor and the lower-order term, and you have O(n²).

## Big-O, Big-Ω and Big-Θ

- **O** is an upper bound: it grows no faster than this.
- **Ω** (Omega) is a lower bound: it grows at least this fast.
- **Θ** (Theta) is a tight bound: both at once.

When people say "merge sort is O(n log n)" they usually mean Θ(n log n), but strictly, Big-O only promises the upper bound.

## Check your understanding

Before the concept check, make sure you can explain:

- why constants are dropped,
- why O(n) is also O(n²),
- and how many steps binary search needs for a million items (about 20).
