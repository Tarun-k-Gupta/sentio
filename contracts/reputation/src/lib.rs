#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, symbol_short};

// ─── Storage Keys ─────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Reputation(Address),
    LastAction(Address, Address), // (from, to) -> timestamp
}

// ─── Constants ────────────────────────────────────────────

const DEFAULT_REPUTATION: i32 = 50;
const LIKE_BONUS: i32 = 3;
const REPORT_PENALTY: i32 = 5;
const MIN_REPUTATION: i32 = 0;
const MAX_REPUTATION: i32 = 100;
const COOLDOWN_SECONDS: u64 = 30; // 30 second cooldown between actions on same pair

// ─── Contract ─────────────────────────────────────────────

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Initialize the contract with an admin address.
    /// The admin can be used for future governance features.
    pub fn init(env: Env, admin: Address) {
        // Only allow initialization once
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Like a user: increases their reputation by LIKE_BONUS (max 100).
    /// Requires authorization from the `from` address.
    /// Prevents self-likes and enforces cooldown.
    /// Returns the new reputation score of the `to` user.
    pub fn like(env: Env, from: Address, to: Address) -> i32 {
        from.require_auth();

        // Prevent self-likes
        if from == to {
            panic!("cannot like yourself");
        }

        // Check cooldown
        Self::check_cooldown(&env, &from, &to);

        // Get current reputation (default 50)
        let key = DataKey::Reputation(to.clone());
        let current: i32 = env.storage().persistent().get(&key).unwrap_or(DEFAULT_REPUTATION);

        // Calculate new reputation (capped at MAX)
        let new_rep = if current + LIKE_BONUS > MAX_REPUTATION {
            MAX_REPUTATION
        } else {
            current + LIKE_BONUS
        };

        // Store updated reputation
        env.storage().persistent().set(&key, &new_rep);

        // Update cooldown timestamp
        Self::set_cooldown(&env, &from, &to);

        // Emit event
        env.events().publish(
            (symbol_short!("rep"), symbol_short!("like")),
            (&from, &to, new_rep),
        );

        new_rep
    }

    /// Report/dislike a user: decreases their reputation by REPORT_PENALTY (min 0).
    /// Requires authorization from the `from` address.
    /// Prevents self-reports and enforces cooldown.
    /// Returns the new reputation score of the `to` user.
    pub fn report(env: Env, from: Address, to: Address) -> i32 {
        from.require_auth();

        // Prevent self-reports
        if from == to {
            panic!("cannot report yourself");
        }

        // Check cooldown
        Self::check_cooldown(&env, &from, &to);

        // Get current reputation (default 50)
        let key = DataKey::Reputation(to.clone());
        let current: i32 = env.storage().persistent().get(&key).unwrap_or(DEFAULT_REPUTATION);

        // Calculate new reputation (floored at MIN)
        let new_rep = if current - REPORT_PENALTY < MIN_REPUTATION {
            MIN_REPUTATION
        } else {
            current - REPORT_PENALTY
        };

        // Store updated reputation
        env.storage().persistent().set(&key, &new_rep);

        // Update cooldown timestamp
        Self::set_cooldown(&env, &from, &to);

        // Emit event
        env.events().publish(
            (symbol_short!("rep"), symbol_short!("report")),
            (&from, &to, new_rep),
        );

        new_rep
    }

    /// Get the reputation score for a user.
    /// Returns DEFAULT_REPUTATION (50) if the user has no score yet.
    pub fn get_reputation(env: Env, user: Address) -> i32 {
        let key = DataKey::Reputation(user);
        env.storage().persistent().get(&key).unwrap_or(DEFAULT_REPUTATION)
    }

    /// Get the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    // ─── Internal Helpers ─────────────────────────────────

    fn check_cooldown(env: &Env, from: &Address, to: &Address) {
        let key = DataKey::LastAction(from.clone(), to.clone());
        if let Some(last_time) = env.storage().temporary().get::<DataKey, u64>(&key) {
            let current_time = env.ledger().timestamp();
            if current_time < last_time + COOLDOWN_SECONDS {
                panic!("cooldown active, please wait");
            }
        }
    }

    fn set_cooldown(env: &Env, from: &Address, to: &Address) {
        let key = DataKey::LastAction(from.clone(), to.clone());
        let current_time = env.ledger().timestamp();
        // Store in temporary storage with a TTL (auto-expires)
        env.storage().temporary().set(&key, &current_time);
        // Extend TTL to 5 minutes (well beyond the 30s cooldown)
        env.storage().temporary().extend_ttl(&key, 300, 300);
    }
}

// ─── Tests ────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_default_reputation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        assert_eq!(client.get_reputation(&user), 50);
    }

    #[test]
    fn test_like() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        let new_rep = client.like(&user_a, &user_b);
        assert_eq!(new_rep, 53); // 50 + 3
        assert_eq!(client.get_reputation(&user_b), 53);
    }

    #[test]
    fn test_report() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        let new_rep = client.report(&user_a, &user_b);
        assert_eq!(new_rep, 45); // 50 - 5
        assert_eq!(client.get_reputation(&user_b), 45);
    }

    #[test]
    fn test_reputation_cap() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let users: soroban_sdk::Vec<Address> = soroban_sdk::vec![
            &env,
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env)
        ];

        let target = Address::generate(&env);

        // Like 20 times from different users -> should cap at 100
        for i in 0..20 {
            let from = users.get(i).unwrap();
            client.like(&from, &target);
        }

        // 50 + (20 * 3) = 110, but capped at 100
        assert_eq!(client.get_reputation(&target), 100);
    }

    #[test]
    fn test_reputation_floor() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let users: soroban_sdk::Vec<Address> = soroban_sdk::vec![
            &env,
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env)
        ];

        let target = Address::generate(&env);

        // Report 11 times from different users -> should floor at 0
        for i in 0..11 {
            let from = users.get(i).unwrap();
            client.report(&from, &target);
        }

        // 50 - (11 * 5) = -5, but floored at 0
        assert_eq!(client.get_reputation(&target), 0);
    }

    #[test]
    #[should_panic(expected = "cannot like yourself")]
    fn test_self_like_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let user = Address::generate(&env);
        client.like(&user, &user); // Should panic
    }

    #[test]
    #[should_panic(expected = "cannot report yourself")]
    fn test_self_report_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let user = Address::generate(&env);
        client.report(&user, &user); // Should panic
    }
}
