import random
import chess
import chess.engine

ENGINE_PATH = r"stockfish\stockfish-windows-x86-64-universal.exe"


def make_position():
    """Play random legal moves to get a random, still-running position."""
    while True:
        board = chess.Board()
        for _ in range(random.randint(10, 30)):
            if board.is_game_over():
                break
            board.push(random.choice(list(board.legal_moves)))
        if not board.is_game_over() and board.legal_moves.count() >= 10:
            return board


def score_moves(engine, board):
    """Ask Stockfish to score every legal move. Returns {move: score}."""
    how_many = board.legal_moves.count()
    results = engine.analyse(board, chess.engine.Limit(time=0.5), multipv=how_many)

    scores = {}
    for result in results:
        move = result["pv"][0]
        scores[move] = result["score"].relative.score(mate_score=10000)
    return scores


PIECES = {"P": "♟", "N": "♞", "B": "♝", "R": "♜", "Q": "♛", "K": "♚"}
LIGHT_SQUARE = 114   
DARK_SQUARE = 65
WHITE_PIECE = 231
BLACK_PIECE = 16


def draw_board(board):
    """Print the board in colour, from the point of view of the side to move."""
    flip = board.turn == chess.BLACK
    ranks = range(8) if flip else range(7, -1, -1)
    files = range(7, -1, -1) if flip else range(8)

    for rank in ranks:
        line = f" {rank + 1} "
        for file in files:
            square = chess.square(file, rank)
            background = LIGHT_SQUARE if (file + rank) % 2 == 1 else DARK_SQUARE
            piece = board.piece_at(square)

            if piece is None:
                symbol, colour = " ", BLACK_PIECE
            else:
                symbol = PIECES[piece.symbol().upper()]
                colour = WHITE_PIECE if piece.color == chess.WHITE else BLACK_PIECE

            line += f"\033[48;5;{background}m\033[38;5;{colour}m {symbol} \033[0m"
        print(line)

    letters = "hgfedcba" if flip else "abcdefgh"
    print("    " + "  ".join(letters))


def play_round(engine):
    """Play one round. Returns points earned, or None if the player quits."""
    board = make_position()
    scores = score_moves(engine, board)

    print()
    draw_board(board)
    print("Side to move:", "White" if board.turn == chess.WHITE else "Black")

    while True:
        answer = input("Your move (or q to quit): ")
        if answer == "q":
            return None
        try:
            player_move = board.parse_san(answer)
            break
        except ValueError:
            print("That's not a legal move, try again.")

    best = max(scores.values())
    points = best - scores[player_move]
    worst_move = min(scores, key=scores.get)

    print(f"You earned {points} points.")
    print(f"The worst move was {board.san(worst_move)}, worth {best - scores[worst_move]} points.")
    return points


engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)

total = 0
rounds = 0

while True:
    points = play_round(engine)
    if points is None:
        break
    total += points
    rounds += 1
    print(f"Round {rounds} done. Total score: {total}")

engine.quit()
print(f"Final score: {total} points in {rounds} rounds.")