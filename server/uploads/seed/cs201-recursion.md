# Recursion and the call stack

A function is **recursive** when it solves a problem by calling itself on a smaller version of the same problem. Recursion is not magic. It is ordinary function calls, managed by the call stack.

## The two parts of every recursive function

1. **Base case.** An input small enough to answer directly, with no further calls.
2. **Recursive case.** Break the problem into a smaller instance, call yourself on it, and combine the result.

```
factorial(n):
    if n == 0:            # base case
        return 1
    return n * factorial(n - 1)   # recursive case
```

If a recursive case does not move strictly closer to a base case, the function never stops. In practice it runs until the stack overflows.

## What the call stack does

Every function call pushes a **stack frame** holding that call's parameters, local variables, and the place to return to. Calling `factorial(3)` builds this stack:

```
factorial(0)   ← returns 1 first
factorial(1)   waiting to compute 1 * 1
factorial(2)   waiting to compute 2 * 1
factorial(3)   waiting to compute 3 * 2
```

Each frame has its **own copy** of `n`. That is why the calls don't interfere with one another. Frames are popped in reverse order as each call returns.

## Memory cost

Because every pending call keeps its frame alive, recursion depth *d* costs O(d) stack memory. A loop that computes the same factorial needs only O(1) extra memory. Recursion is often clearer, but it is **not** cheaper.

## When recursion branches

Some problems make more than one recursive call:

```
fib(n):
    if n < 2: return n
    return fib(n - 1) + fib(n - 2)
```

Each call spawns two more, so the call tree roughly doubles at every level. That makes the number of calls exponential, O(2ⁿ) as an upper bound. The real waste is that `fib(n - 2)` is computed again inside `fib(n - 1)`. The same sub-problems are solved over and over.

## Memoisation

Store each answer the first time you compute it, and look it up afterwards:

```
memo = {}
fib(n):
    if n < 2: return n
    if n in memo: return memo[n]
    memo[n] = fib(n - 1) + fib(n - 2)
    return memo[n]
```

Now each value from 0 to *n* is computed once, so the running time drops to O(n). This idea is the starting point for **dynamic programming**.

## Thinking recursively

When designing a recursive solution, trust the recursive call. Assume `solve(smaller)` already works, then ask only:

- What is the smallest case, and what is its answer?
- How do I build the answer for *n* from the answer for a smaller input?

## Check your understanding

- What happens if a base case is missing?
- Why do local variables in different calls not clash?
- Why does memoisation turn exponential Fibonacci into linear time?
