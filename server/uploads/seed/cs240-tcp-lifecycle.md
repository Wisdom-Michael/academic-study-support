# The TCP connection lifecycle

TCP (Transmission Control Protocol) gives applications a **reliable, ordered byte stream** on top of IP, which can lose, duplicate, and reorder packets. To do that, both ends keep state about the connection. This chapter follows a connection from opening to closing.

## Sequence numbers

Every byte sent over a TCP connection has a **sequence number**. The receiver uses these numbers to:

- put segments back in order before handing data to the application,
- discard duplicates,
- and acknowledge what has arrived, so the sender knows what to retransmit.

Because of this, the receiving application always reads bytes in the order they were sent.

## Opening: the three-way handshake

Both sides need to agree on starting sequence numbers before any data flows.

```
Client                         Server
  | ---- SYN (seq = x) ---------> |   "I want to talk; my numbers start at x"
  | <--- SYN-ACK (seq = y,        |   "OK; mine start at y; I got x"
  |           ack = x + 1) ------ |
  | ---- ACK (ack = y + 1) -----> |   "I got y"
  |        ESTABLISHED            |
```

Three messages are the minimum, because each side must both announce its own starting number and confirm the other's.

## Transferring data

Once established, each side sends segments and acknowledges what it receives. Lost segments are detected by timeouts or duplicate acknowledgements, then retransmitted. **Flow control** (the receive window) stops a fast sender from overwhelming a slow receiver. **Congestion control** stops senders from overwhelming the network.

## Closing: each direction separately

A TCP connection is really two one-way streams, and each is closed independently with a **FIN**:

```
Active closer                  Passive closer
  | ---- FIN -------------------> |   "I have no more data to send"
  | <--- ACK -------------------- |
  |          (data may still flow from the passive side)
  | <--- FIN -------------------- |
  | ---- ACK -------------------> |
  TIME_WAIT                    CLOSED
```

Between the first FIN and the second, the connection is **half-closed**. One direction is finished while the other can still carry data.

## TIME_WAIT

The side that sent the **first** FIN (the active closer) waits in TIME_WAIT for twice the maximum segment lifetime before fully closing. This has two purposes:

1. If its final ACK is lost, the other side will resend its FIN, and the active closer is still around to acknowledge it.
2. Delayed segments from the old connection die out before a new connection could reuse the same addresses and ports and mistake them for fresh data.

## State summary

| State        | Meaning                                           |
|--------------|---------------------------------------------------|
| LISTEN       | Server waiting for a SYN                          |
| SYN_SENT     | Client sent SYN, waiting for SYN-ACK              |
| ESTABLISHED  | Handshake complete; data can flow                 |
| FIN_WAIT     | Active closer sent FIN                            |
| CLOSE_WAIT   | Passive closer received FIN; app hasn't closed yet|
| TIME_WAIT    | Active closer waiting for stray segments to die   |
| CLOSED       | No connection                                     |

## Check your understanding

- Why does the handshake need three messages and not two?
- What does "half-closed" mean?
- Which side ends up in TIME_WAIT, and why?
