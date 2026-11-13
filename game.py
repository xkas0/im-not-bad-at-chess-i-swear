import random
import chess


def make_position():
    """Play a random number of random legal moves from the starting position."""
    while True:
        board = chess.Board()
        number_of_moves = random.randint(10, 30)

        for _ in range(number_of_moves):
            if board.is_game_over():
                break
            move = random.choice(list(board.legal_moves))
            board.push(move)

        
        if not board.is_game_over() and board.legal_moves.count() >= 10:
            return board


board = make_position()

print(board)
print()
print("Side to move:", "White" if board.turn == chess.WHITE else "Black")

legal_moves = [board.san(move) for move in board.legal_moves]
print(f"{len(legal_moves)} legal moves:")
print(", ".join(legal_moves))

answer = input("Your move: ")

try:
    move = board.parse_san(answer)
    print("Legal move:", board.san(move))
except ValueError:
    print("That's not a legal move.")