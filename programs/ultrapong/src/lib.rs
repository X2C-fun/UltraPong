use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_lang::InstructionData;
use ephemeral_rollups_sdk::vrf::{
    self,
    anchor::{vrf, vrf_callback},
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use ephemeral_rollups_sdk::{
    anchor::{commit, delegate, ephemeral},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
};
use magicblock_magic_program_api::{
    args::ScheduleTaskArgs, instruction::MagicBlockInstruction, pda::crank_signer_pda,
};
use ultrapong_physics::{Game, V};
declare_id!("37DBNkDoLdAgnKrtQfMYSLF7jUZ1HqQsN8fqNKhVYQkh");
pub const STAKE: u64 = 10_000_000;
pub const VALIDATOR: Pubkey = pubkey!("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");

#[ephemeral]
#[program]
pub mod ultrapong {
    use super::*;
    pub fn create_room(
        ctx: Context<CreateRoom>,
        nonce: u64,
        wager: bool,
        sabotage: bool,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.room;
        r.creator = ctx.accounts.payer.key();
        r.nonce = nonce;
        r.wager = wager;
        r.sabotage = sabotage;
        r.created = now;
        r.round = 0;
        ctx.accounts.escrow.room = r.key();
        ctx.accounts.game.room = r.key();
        ctx.accounts.game.bump = ctx.bumps.game;
        Ok(())
    }
    pub fn join(ctx: Context<Join>, name: [u8; 16], session: Pubkey) -> Result<()> {
        let r = &mut ctx.accounts.room;
        require!(
            r.state == 0 && Clock::get()?.unix_timestamp < r.created + 120,
            ErrorCode::LobbyClosed
        );
        require!(
            r.count < 8 && session != Pubkey::default(),
            ErrorCode::RoomFull
        );
        require!(
            !r.players.contains(&ctx.accounts.payer.key()),
            ErrorCode::AlreadyJoined
        );
        require!(
            !r.sessions[..r.count as usize].contains(&session)
                && !r.players[..r.count as usize].contains(&session),
            ErrorCode::Unauthorized
        );
        let i = r.count as usize;
        r.players[i] = ctx.accounts.payer.key();
        r.sessions[i] = session;
        r.names[i] = name;
        r.ready[i] = false;
        r.count += 1;
        r.countdown = 0;
        if r.wager {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.escrow.to_account_info(),
                    },
                ),
                STAKE,
            )?;
            ctx.accounts.escrow.total += STAKE;
        }
        Ok(())
    }
    pub fn ready(ctx: Context<RoomPlayer>) -> Result<()> {
        let r = &mut ctx.accounts.room;
        require!(
            r.state == 0 && Clock::get()?.unix_timestamp < r.created + 120,
            ErrorCode::LobbyClosed
        );
        let i = member(&r.players, r.count, ctx.accounts.payer.key())?;
        r.ready[i] = true;
        if r.count >= if r.wager { 2 } else { 1 }
            && r.ready[..r.count as usize].iter().all(|v| *v)
            && r.countdown == 0
        {
            r.countdown = Clock::get()?.unix_timestamp + 8;
        }
        Ok(())
    }
    pub fn withdraw(ctx: Context<Join>) -> Result<()> {
        let r = &mut ctx.accounts.room;
        require!(r.state == 0, ErrorCode::LobbyClosed);
        let i = member(&r.players, r.count, ctx.accounts.payer.key())?;
        if r.wager {
            pay(
                &ctx.accounts.escrow.to_account_info(),
                &ctx.accounts.payer.to_account_info(),
                STAKE,
            )?;
            ctx.accounts.escrow.total -= STAKE;
        }
        for j in i..r.count as usize - 1 {
            r.players[j] = r.players[j + 1];
            r.sessions[j] = r.sessions[j + 1];
            r.names[j] = r.names[j + 1];
            r.ready[j] = r.ready[j + 1];
        }
        r.count -= 1;
        let j = r.count as usize;
        r.players[j] = Pubkey::default();
        r.ready[j] = false;
        r.countdown = 0;
        Ok(())
    }
    pub fn lock_and_delegate(ctx: Context<LockMatch>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.room;
        require!(
            r.state == 0 && r.countdown > 0 && now >= r.countdown && now < r.created + 120,
            ErrorCode::NotReady
        );
        require!(
            r.count >= if r.wager { 2 } else { 1 }
                && r.ready[..r.count as usize].iter().all(|v| *v),
            ErrorCode::NotReady
        );
        r.state = 1;
        ctx.accounts.escrow.deadline = now + 900;
        let mut m = MatchState::try_deserialize(&mut &ctx.accounts.game.data.borrow()[..])?;
        require!(
            m.room == r.key() && m.round == r.round,
            ErrorCode::WrongMatch
        );
        m.humans = r.count;
        m.players = r.players;
        m.sessions = r.sessions;
        m.sabotage = r.sabotage;
        m.wager = r.wager;
        m.start = now;
        m.heartbeat = [now; 8];
        m.expiry = now + 1800;
        let bytes = m.key_bytes(&ctx.accounts.game.key());
        m.task = i64::from_le_bytes(bytes) & i64::MAX;
        m.try_serialize(&mut &mut ctx.accounts.game.data.borrow_mut()[..])?;
        let room_key = r.key();
        let round = r.round.to_le_bytes();
        ctx.accounts.delegate_game(
            &ctx.accounts.payer,
            &[b"match", room_key.as_ref(), &round],
            DelegateConfig {
                validator: Some(VALIDATOR),
                commit_frequency_ms: u32::MAX,
                ..Default::default()
            },
        )?;
        Ok(())
    }
    pub fn request_seed(ctx: Context<RequestSeed>) -> Result<()> {
        require!(ctx.accounts.game.status == 0, ErrorCode::WrongPhase);
        let seed = ctx.accounts.game.room.to_bytes();
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::ReceiveSeed::DISCRIMINATOR.to_vec(),
            caller_seed: seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.game.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }
    pub fn receive_seed(ctx: Context<ReceiveSeed>, randomness: [u8; 32]) -> Result<()> {
        let m = &mut ctx.accounts.game;
        if m.status != 0 {
            return Ok(());
        }
        require!(m.humans > 0, ErrorCode::WrongPhase);
        let n = if m.wager { m.humans } else { 8 };
        let bots = if m.wager {
            0
        } else {
            (255u16 << m.humans) as u8
        };
        let mut seed = [0; 8];
        seed.copy_from_slice(&randomness[..8]);
        m.data = borsh::to_vec(&Game::new(
            n as usize,
            u64::from_le_bytes(seed),
            bots,
            m.sabotage,
        ))
        .map_err(|_| ErrorCode::BadState)?;
        m.status = 1;
        m.start = Clock::get()?.unix_timestamp;
        m.heartbeat = [m.start; 8];
        Ok(())
    }
    pub fn start_crank(ctx: Context<StartCrank>) -> Result<()> {
        let m = &mut ctx.accounts.game;
        require!(m.status == 1 && !m.scheduled, ErrorCode::WrongPhase);
        m.scheduled = true;
        let key = m.key();
        let signer = crank_signer_pda(&key);
        let tick_ix = Instruction {
            program_id: ID,
            accounts: vec![
                AccountMeta::new(key, false),
                AccountMeta::new_readonly(signer, true),
            ],
            data: instruction::Tick {}.data(),
        };
        let schedule = MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
            task_id: m.task,
            execution_interval_millis: 50,
            iterations: 6200,
            instructions: vec![tick_ix],
        });
        let ix = Instruction::new_with_bytes(
            ctx.accounts.magic_program.key(),
            &bincode::serialize(&schedule).map_err(|_| ErrorCode::BadState)?,
            vec![
                AccountMeta::new(key, true),
                AccountMeta::new(key, false),
                AccountMeta::new_readonly(signer, false),
            ],
        );
        let room = m.room;
        let round = m.round.to_le_bytes();
        let bump = [m.bump];
        m.exit(&ID)?;
        invoke_signed(
            &ix,
            &[
                m.to_account_info(),
                ctx.accounts.crank_signer.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            ],
            &[&[b"match", room.as_ref(), &round, &bump]],
        )?;
        Ok(())
    }
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        let m = &mut ctx.accounts.game;
        require_keys_eq!(
            ctx.accounts.crank_signer.key(),
            crank_signer_pda(&m.key()),
            ErrorCode::Unauthorized
        );
        if m.status != 1 {
            return Ok(());
        }
        let clock = Clock::get()?;
        if m.last_slot == clock.slot {
            return Ok(());
        }
        m.last_slot = clock.slot;
        let mut g = decode(m)?;
        for i in 0..m.humans as usize {
            if clock.unix_timestamp - m.heartbeat[i] >= 20 {
                g.eliminate(i);
            }
        }
        if m.heartbeat[..m.humans as usize]
            .iter()
            .all(|t| clock.unix_timestamp - *t >= 20)
        {
            g.finished = true;
            g.winner = -1;
        }
        g.step();
        if g.finished {
            m.status = 2;
        }
        m.data = encode(&g)?;
        Ok(())
    }
    pub fn input(ctx: Context<Input>, sequence: u64, target: u16) -> Result<()> {
        let m = &mut ctx.accounts.game;
        require!(m.status == 1, ErrorCode::WrongPhase);
        let i = authorized(m, ctx.accounts.signer.key())?;
        require!(
            sequence > m.sequence[i] && target <= 10000,
            ErrorCode::BadInput
        );
        m.sequence[i] = sequence;
        m.heartbeat[i] = Clock::get()?.unix_timestamp;
        let mut g = decode(m)?;
        g.input(i, target as i64);
        m.data = encode(&g)?;
        Ok(())
    }
    pub fn hazard(ctx: Context<Input>, sequence: u64, kind: u8, x: i32, y: i32) -> Result<()> {
        let m = &mut ctx.accounts.game;
        require!(m.status == 1, ErrorCode::WrongPhase);
        let i = authorized(m, ctx.accounts.signer.key())?;
        require!(sequence > m.sequence[i], ErrorCode::BadInput);
        let mut g = decode(m)?;
        g.place(i, kind, V::new(x as i64, y as i64))
            .map_err(|_| ErrorCode::InvalidHazard)?;
        m.sequence[i] = sequence;
        m.heartbeat[i] = Clock::get()?.unix_timestamp;
        m.data = encode(&g)?;
        Ok(())
    }
    pub fn renew_session(ctx: Context<Input>, session: Pubkey) -> Result<()> {
        let m = &mut ctx.accounts.game;
        let i = member(&m.players, m.humans, ctx.accounts.signer.key())?;
        require!(
            m.status == 1 && Clock::get()?.unix_timestamp < m.expiry,
            ErrorCode::WrongPhase
        );
        require!(
            session != Pubkey::default()
                && !m.sessions[..m.humans as usize]
                    .iter()
                    .enumerate()
                    .any(|(j, s)| j != i && *s == session)
                && !m.players[..m.humans as usize]
                    .iter()
                    .enumerate()
                    .any(|(j, p)| j != i && *p == session),
            ErrorCode::Unauthorized
        );
        m.sessions[i] = session;
        m.sequence[i] = 0;
        m.heartbeat[i] = Clock::get()?.unix_timestamp;
        Ok(())
    }
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let m = &ctx.accounts.game;
        require!(m.status == 2, ErrorCode::WrongPhase);
        if m.scheduled {
            let cancel = Instruction::new_with_bytes(
                ctx.accounts.magic_program.key(),
                &bincode::serialize(&MagicBlockInstruction::CancelTask { task_id: m.task })
                    .map_err(|_| ErrorCode::BadState)?,
                vec![
                    AccountMeta::new(m.key(), true),
                    AccountMeta::new(m.key(), false),
                ],
            );
            let round = m.round.to_le_bytes();
            let bump = [m.bump];
            invoke_signed(
                &cancel,
                &[
                    m.to_account_info(),
                    ctx.accounts.magic_program.to_account_info(),
                ],
                &[&[b"match", m.room.as_ref(), &round, &bump]],
            )?;
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[m.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let r = &mut ctx.accounts.room;
        let e = &mut ctx.accounts.escrow;
        if e.state == 1 {
            return Ok(());
        }
        require!(
            e.state == 0 && r.state == 1 && Clock::get()?.unix_timestamp < e.deadline,
            ErrorCode::Expired
        );
        let m = &ctx.accounts.game;
        require!(m.status == 2, ErrorCode::WrongPhase);
        let g = decode(m)?;
        require!(g.finished, ErrorCode::WrongPhase);
        if g.winner < 0 {
            e.state = 2;
            r.state = 3;
            return Ok(());
        }
        let winner = if !r.wager && g.winner as u8 >= r.count {
            r.creator
        } else {
            r.players[g.winner as usize]
        };
        require_keys_eq!(ctx.accounts.winner.key(), winner, ErrorCode::Unauthorized);
        let amount = e.total;
        e.total = 0;
        e.state = 1;
        r.state = 2;
        pay(
            &e.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            amount,
        )?;
        Ok(())
    }
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let r = &mut ctx.accounts.room;
        let e = &mut ctx.accounts.escrow;
        let i = member(&r.players, r.count, ctx.accounts.payer.key())?;
        require!(
            e.state != 1
                && (e.state == 2 || (r.state == 1 && Clock::get()?.unix_timestamp >= e.deadline)),
            ErrorCode::NotRefundable
        );
        e.state = 2;
        r.state = 3;
        if e.refunded[i] {
            return Ok(());
        }
        e.refunded[i] = true;
        if r.wager {
            e.total -= STAKE;
            pay(
                &e.to_account_info(),
                &ctx.accounts.payer.to_account_info(),
                STAKE,
            )?;
        }
        Ok(())
    }
    pub fn next_round(ctx: Context<NextRound>) -> Result<()> {
        let r = &mut ctx.accounts.room;
        require!(
            r.state >= 2 && ctx.accounts.escrow.total == 0,
            ErrorCode::WrongPhase
        );
        r.round += 1;
        r.count = 0;
        r.players = [Pubkey::default(); 8];
        r.sessions = [Pubkey::default(); 8];
        r.ready = [false; 8];
        r.names = [[0; 16]; 8];
        r.state = 0;
        r.countdown = 0;
        r.created = Clock::get()?.unix_timestamp;
        ctx.accounts.escrow.state = 0;
        ctx.accounts.escrow.refunded = [false; 8];
        ctx.accounts.game.room = r.key();
        ctx.accounts.game.round = r.round;
        ctx.accounts.game.bump = ctx.bumps.game;
        Ok(())
    }
}
fn member(players: &[Pubkey; 8], count: u8, key: Pubkey) -> Result<usize> {
    players[..count as usize]
        .iter()
        .position(|p| *p == key)
        .ok_or(error!(ErrorCode::Unauthorized))
}
fn authorized(m: &MatchState, key: Pubkey) -> Result<usize> {
    require!(Clock::get()?.unix_timestamp < m.expiry, ErrorCode::Expired);
    m.players[..m.humans as usize]
        .iter()
        .position(|p| *p == key)
        .or_else(|| {
            m.sessions[..m.humans as usize]
                .iter()
                .position(|s| *s == key)
        })
        .ok_or(error!(ErrorCode::Unauthorized))
}
fn decode(m: &MatchState) -> Result<Game> {
    Game::from_bytes(&m.data).map_err(|_| error!(ErrorCode::BadState))
}
fn encode(g: &Game) -> Result<Vec<u8>> {
    borsh::to_vec(g).map_err(|_| error!(ErrorCode::BadState))
}
fn pay(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    require!(from.lamports() >= amount, ErrorCode::BadState);
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}

#[account]
pub struct Room {
    pub creator: Pubkey,
    pub nonce: u64,
    pub round: u64,
    pub wager: bool,
    pub sabotage: bool,
    pub state: u8,
    pub count: u8,
    pub created: i64,
    pub countdown: i64,
    pub players: [Pubkey; 8],
    pub sessions: [Pubkey; 8],
    pub names: [[u8; 16]; 8],
    pub ready: [bool; 8],
}
#[account]
pub struct Escrow {
    pub room: Pubkey,
    pub total: u64,
    pub deadline: i64,
    pub state: u8,
    pub refunded: [bool; 8],
}
#[account]
pub struct MatchState {
    pub room: Pubkey,
    pub round: u64,
    pub bump: u8,
    pub humans: u8,
    pub players: [Pubkey; 8],
    pub sessions: [Pubkey; 8],
    pub sequence: [u64; 8],
    pub heartbeat: [i64; 8],
    pub expiry: i64,
    pub start: i64,
    pub last_slot: u64,
    pub task: i64,
    pub status: u8,
    pub scheduled: bool,
    pub wager: bool,
    pub sabotage: bool,
    pub data: Vec<u8>,
}
impl MatchState {
    fn key_bytes(&self, key: &Pubkey) -> [u8; 8] {
        let mut b = [0; 8];
        b.copy_from_slice(&key.to_bytes()[..8]);
        b
    }
}

#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init,payer=payer,space=1024,seeds=[b"room",payer.key().as_ref(),&nonce.to_le_bytes()],bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(init,payer=payer,space=128,seeds=[b"escrow",room.key().as_ref()],bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(init,payer=payer,space=8192,seeds=[b"match",room.key().as_ref(),&0u64.to_le_bytes()],bump)]
    pub game: Box<Account<'info, MatchState>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut,seeds=[b"escrow",room.key().as_ref()],bump,has_one=room)]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct RoomPlayer<'info> {
    pub payer: Signer<'info>,
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,
}
#[delegate]
#[derive(Accounts)]
pub struct LockMatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut,seeds=[b"escrow",room.key().as_ref()],bump,has_one=room)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: PDA validated and explicitly serialized before delegation.
    #[account(mut, del)]
    pub game: AccountInfo<'info>,
}
#[vrf]
#[derive(Accounts)]
pub struct RequestSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, MatchState>>,
    /// CHECK: SDK queue address constrained.
    #[account(mut,address=vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}
#[vrf_callback]
#[derive(Accounts)]
pub struct ReceiveSeed<'info> {
    #[account(mut)]
    pub game: Box<Account<'info, MatchState>>,
}
#[derive(Accounts)]
pub struct StartCrank<'info> {
    #[account(mut,seeds=[b"match",game.room.as_ref(),&game.round.to_le_bytes()],bump=game.bump)]
    pub game: Box<Account<'info, MatchState>>,
    /// CHECK: MagicBlock scheduler program.
    #[account(address=ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: Derived read-only signer passed to scheduler.
    #[account(address=crank_signer_pda(&game.key()))]
    pub crank_signer: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut)]
    pub game: Box<Account<'info, MatchState>>,
    pub crank_signer: Signer<'info>,
}
#[derive(Accounts)]
pub struct Input<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, MatchState>>,
}
#[commit]
#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, MatchState>>,
}
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut,seeds=[b"escrow",room.key().as_ref()],bump,has_one=room)]
    pub escrow: Account<'info, Escrow>,
    #[account(seeds=[b"match",room.key().as_ref(),&room.round.to_le_bytes()],bump=game.bump,has_one=room)]
    pub game: Box<Account<'info, MatchState>>,
    /// CHECK: Destination must equal program-computed winner.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut,seeds=[b"escrow",room.key().as_ref()],bump,has_one=room)]
    pub escrow: Account<'info, Escrow>,
}
#[derive(Accounts)]
pub struct NextRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut,seeds=[b"escrow",room.key().as_ref()],bump,has_one=room)]
    pub escrow: Account<'info, Escrow>,
    #[account(init,payer=payer,space=8192,seeds=[b"match",room.key().as_ref(),&(room.round+1).to_le_bytes()],bump)]
    pub game: Box<Account<'info, MatchState>>,
    pub system_program: Program<'info, System>,
}
#[error_code]
pub enum ErrorCode {
    #[msg("The lobby is closed or expired")]
    LobbyClosed,
    #[msg("The room is full")]
    RoomFull,
    #[msg("You already joined this room")]
    AlreadyJoined,
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Wait for everyone to ready up and the countdown to finish")]
    NotReady,
    #[msg("Wrong match")]
    WrongMatch,
    #[msg("Action unavailable in this match phase")]
    WrongPhase,
    #[msg("Invalid game state")]
    BadState,
    #[msg("Expired session or settlement deadline")]
    Expired,
    #[msg("Invalid or replayed input")]
    BadInput,
    #[msg("Hazard placement refused")]
    InvalidHazard,
    #[msg("Refund is not available yet")]
    NotRefundable,
}
