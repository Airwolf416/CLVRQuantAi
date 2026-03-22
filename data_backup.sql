--
-- PostgreSQL database dump
--

\restrict fDQCVrBeWjMBNnZrk0yB7PHTSykVrO3Px1TKX6UVdBX51MTlHckwhR2uXSVFbU5

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: stripe; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA stripe;


ALTER SCHEMA stripe OWNER TO postgres;

--
-- Name: invoice_status; Type: TYPE; Schema: stripe; Owner: postgres
--

CREATE TYPE stripe.invoice_status AS ENUM (
    'draft',
    'open',
    'paid',
    'uncollectible',
    'void',
    'deleted'
);


ALTER TYPE stripe.invoice_status OWNER TO postgres;

--
-- Name: pricing_tiers; Type: TYPE; Schema: stripe; Owner: postgres
--

CREATE TYPE stripe.pricing_tiers AS ENUM (
    'graduated',
    'volume'
);


ALTER TYPE stripe.pricing_tiers OWNER TO postgres;

--
-- Name: pricing_type; Type: TYPE; Schema: stripe; Owner: postgres
--

CREATE TYPE stripe.pricing_type AS ENUM (
    'one_time',
    'recurring'
);


ALTER TYPE stripe.pricing_type OWNER TO postgres;

--
-- Name: subscription_schedule_status; Type: TYPE; Schema: stripe; Owner: postgres
--

CREATE TYPE stripe.subscription_schedule_status AS ENUM (
    'not_started',
    'active',
    'completed',
    'released',
    'canceled'
);


ALTER TYPE stripe.subscription_schedule_status OWNER TO postgres;

--
-- Name: subscription_status; Type: TYPE; Schema: stripe; Owner: postgres
--

CREATE TYPE stripe.subscription_status AS ENUM (
    'trialing',
    'active',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'unpaid',
    'paused'
);


ALTER TYPE stripe.subscription_status OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new._updated_at = now();
  return NEW;
end;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: set_updated_at_metadata(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at_metadata() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return NEW;
end;
$$;


ALTER FUNCTION public.set_updated_at_metadata() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.access_codes (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    type text DEFAULT 'vip'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    used_by text,
    used_at timestamp without time zone,
    expires_at timestamp without time zone,
    use_count integer DEFAULT 0,
    max_uses integer
);


ALTER TABLE public.access_codes OWNER TO postgres;

--
-- Name: daily_briefs_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.daily_briefs_log (
    id integer NOT NULL,
    date_key character varying(10) NOT NULL,
    sent_at timestamp without time zone DEFAULT now(),
    recipient_count integer DEFAULT 0
);


ALTER TABLE public.daily_briefs_log OWNER TO postgres;

--
-- Name: daily_briefs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.daily_briefs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.daily_briefs_log_id_seq OWNER TO postgres;

--
-- Name: daily_briefs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.daily_briefs_log_id_seq OWNED BY public.daily_briefs_log.id;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    user_id text NOT NULL,
    subscription jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.push_subscriptions OWNER TO postgres;

--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.push_subscriptions_id_seq OWNER TO postgres;

--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referrals (
    id integer NOT NULL,
    referrer_user_id text NOT NULL,
    referred_user_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reward_granted boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.referrals OWNER TO postgres;

--
-- Name: referrals_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.referrals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.referrals_id_seq OWNER TO postgres;

--
-- Name: referrals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.referrals_id_seq OWNED BY public.referrals.id;


--
-- Name: subscribers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscribers (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text DEFAULT 'Trader'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.subscribers OWNER TO postgres;

--
-- Name: user_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_alerts (
    id integer NOT NULL,
    user_id text NOT NULL,
    sym text NOT NULL,
    field text NOT NULL,
    condition text NOT NULL,
    threshold text NOT NULL,
    label text NOT NULL,
    triggered boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone NOT NULL
);


ALTER TABLE public.user_alerts OWNER TO postgres;

--
-- Name: user_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_alerts_id_seq OWNER TO postgres;

--
-- Name: user_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_alerts_id_seq OWNED BY public.user_alerts.id;


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.user_sessions OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    tier text DEFAULT 'free'::text NOT NULL,
    email text NOT NULL,
    name text DEFAULT 'Trader'::text NOT NULL,
    subscribe_to_brief boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    reset_token text,
    reset_token_expiry timestamp without time zone,
    promo_code text,
    promo_expires_at timestamp without time zone,
    referral_code text,
    referred_by text,
    must_change_password boolean DEFAULT false,
    email_verified boolean DEFAULT false NOT NULL,
    email_verification_token text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: webauthn_credentials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.webauthn_credentials (
    id integer NOT NULL,
    user_id text NOT NULL,
    credential_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.webauthn_credentials OWNER TO postgres;

--
-- Name: webauthn_credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.webauthn_credentials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.webauthn_credentials_id_seq OWNER TO postgres;

--
-- Name: webauthn_credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.webauthn_credentials_id_seq OWNED BY public.webauthn_credentials.id;


--
-- Name: _managed_webhooks; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe._managed_webhooks (
    id text NOT NULL,
    object text,
    url text NOT NULL,
    enabled_events jsonb NOT NULL,
    description text,
    enabled boolean,
    livemode boolean,
    metadata jsonb,
    secret text NOT NULL,
    status text,
    api_version text,
    created integer,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_synced_at timestamp with time zone,
    account_id text NOT NULL
);


ALTER TABLE stripe._managed_webhooks OWNER TO postgres;

--
-- Name: _migrations; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe._migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE stripe._migrations OWNER TO postgres;

--
-- Name: _sync_status; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe._sync_status (
    id integer NOT NULL,
    resource text NOT NULL,
    status text DEFAULT 'idle'::text,
    last_synced_at timestamp with time zone DEFAULT now(),
    last_incremental_cursor timestamp with time zone,
    error_message text,
    updated_at timestamp with time zone DEFAULT now(),
    account_id text NOT NULL,
    CONSTRAINT _sync_status_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'running'::text, 'complete'::text, 'error'::text])))
);


ALTER TABLE stripe._sync_status OWNER TO postgres;

--
-- Name: _sync_status_id_seq; Type: SEQUENCE; Schema: stripe; Owner: postgres
--

CREATE SEQUENCE stripe._sync_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE stripe._sync_status_id_seq OWNER TO postgres;

--
-- Name: _sync_status_id_seq; Type: SEQUENCE OWNED BY; Schema: stripe; Owner: postgres
--

ALTER SEQUENCE stripe._sync_status_id_seq OWNED BY stripe._sync_status.id;


--
-- Name: accounts; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.accounts (
    _raw_data jsonb NOT NULL,
    first_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    _last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    _updated_at timestamp with time zone DEFAULT now() NOT NULL,
    business_name text GENERATED ALWAYS AS (((_raw_data -> 'business_profile'::text) ->> 'name'::text)) STORED,
    email text GENERATED ALWAYS AS ((_raw_data ->> 'email'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    charges_enabled boolean GENERATED ALWAYS AS (((_raw_data ->> 'charges_enabled'::text))::boolean) STORED,
    payouts_enabled boolean GENERATED ALWAYS AS (((_raw_data ->> 'payouts_enabled'::text))::boolean) STORED,
    details_submitted boolean GENERATED ALWAYS AS (((_raw_data ->> 'details_submitted'::text))::boolean) STORED,
    country text GENERATED ALWAYS AS ((_raw_data ->> 'country'::text)) STORED,
    default_currency text GENERATED ALWAYS AS ((_raw_data ->> 'default_currency'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    api_key_hashes text[] DEFAULT '{}'::text[],
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.accounts OWNER TO postgres;

--
-- Name: active_entitlements; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.active_entitlements (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    feature text GENERATED ALWAYS AS ((_raw_data ->> 'feature'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    lookup_key text GENERATED ALWAYS AS ((_raw_data ->> 'lookup_key'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.active_entitlements OWNER TO postgres;

--
-- Name: charges; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.charges (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    paid boolean GENERATED ALWAYS AS (((_raw_data ->> 'paid'::text))::boolean) STORED,
    "order" text GENERATED ALWAYS AS ((_raw_data ->> 'order'::text)) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    review text GENERATED ALWAYS AS ((_raw_data ->> 'review'::text)) STORED,
    source jsonb GENERATED ALWAYS AS ((_raw_data -> 'source'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    dispute text GENERATED ALWAYS AS ((_raw_data ->> 'dispute'::text)) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    outcome jsonb GENERATED ALWAYS AS ((_raw_data -> 'outcome'::text)) STORED,
    refunds jsonb GENERATED ALWAYS AS ((_raw_data -> 'refunds'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    captured boolean GENERATED ALWAYS AS (((_raw_data ->> 'captured'::text))::boolean) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    refunded boolean GENERATED ALWAYS AS (((_raw_data ->> 'refunded'::text))::boolean) STORED,
    shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping'::text)) STORED,
    application text GENERATED ALWAYS AS ((_raw_data ->> 'application'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    destination text GENERATED ALWAYS AS ((_raw_data ->> 'destination'::text)) STORED,
    failure_code text GENERATED ALWAYS AS ((_raw_data ->> 'failure_code'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    fraud_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'fraud_details'::text)) STORED,
    receipt_email text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_email'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    receipt_number text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_number'::text)) STORED,
    transfer_group text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_group'::text)) STORED,
    amount_refunded bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_refunded'::text))::bigint) STORED,
    application_fee text GENERATED ALWAYS AS ((_raw_data ->> 'application_fee'::text)) STORED,
    failure_message text GENERATED ALWAYS AS ((_raw_data ->> 'failure_message'::text)) STORED,
    source_transfer text GENERATED ALWAYS AS ((_raw_data ->> 'source_transfer'::text)) STORED,
    balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'balance_transaction'::text)) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    payment_method_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_details'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.charges OWNER TO postgres;

--
-- Name: checkout_session_line_items; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.checkout_session_line_items (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount_discount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_discount'::text))::integer) STORED,
    amount_subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_subtotal'::text))::integer) STORED,
    amount_tax integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_tax'::text))::integer) STORED,
    amount_total integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_total'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    price text GENERATED ALWAYS AS ((_raw_data ->> 'price'::text)) STORED,
    quantity integer GENERATED ALWAYS AS (((_raw_data ->> 'quantity'::text))::integer) STORED,
    checkout_session text GENERATED ALWAYS AS ((_raw_data ->> 'checkout_session'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.checkout_session_line_items OWNER TO postgres;

--
-- Name: checkout_sessions; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.checkout_sessions (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    adaptive_pricing jsonb GENERATED ALWAYS AS ((_raw_data -> 'adaptive_pricing'::text)) STORED,
    after_expiration jsonb GENERATED ALWAYS AS ((_raw_data -> 'after_expiration'::text)) STORED,
    allow_promotion_codes boolean GENERATED ALWAYS AS (((_raw_data ->> 'allow_promotion_codes'::text))::boolean) STORED,
    amount_subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_subtotal'::text))::integer) STORED,
    amount_total integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_total'::text))::integer) STORED,
    automatic_tax jsonb GENERATED ALWAYS AS ((_raw_data -> 'automatic_tax'::text)) STORED,
    billing_address_collection text GENERATED ALWAYS AS ((_raw_data ->> 'billing_address_collection'::text)) STORED,
    cancel_url text GENERATED ALWAYS AS ((_raw_data ->> 'cancel_url'::text)) STORED,
    client_reference_id text GENERATED ALWAYS AS ((_raw_data ->> 'client_reference_id'::text)) STORED,
    client_secret text GENERATED ALWAYS AS ((_raw_data ->> 'client_secret'::text)) STORED,
    collected_information jsonb GENERATED ALWAYS AS ((_raw_data -> 'collected_information'::text)) STORED,
    consent jsonb GENERATED ALWAYS AS ((_raw_data -> 'consent'::text)) STORED,
    consent_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'consent_collection'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    currency_conversion jsonb GENERATED ALWAYS AS ((_raw_data -> 'currency_conversion'::text)) STORED,
    custom_fields jsonb GENERATED ALWAYS AS ((_raw_data -> 'custom_fields'::text)) STORED,
    custom_text jsonb GENERATED ALWAYS AS ((_raw_data -> 'custom_text'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    customer_creation text GENERATED ALWAYS AS ((_raw_data ->> 'customer_creation'::text)) STORED,
    customer_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_details'::text)) STORED,
    customer_email text GENERATED ALWAYS AS ((_raw_data ->> 'customer_email'::text)) STORED,
    discounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'discounts'::text)) STORED,
    expires_at integer GENERATED ALWAYS AS (((_raw_data ->> 'expires_at'::text))::integer) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    invoice_creation jsonb GENERATED ALWAYS AS ((_raw_data -> 'invoice_creation'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    locale text GENERATED ALWAYS AS ((_raw_data ->> 'locale'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    mode text GENERATED ALWAYS AS ((_raw_data ->> 'mode'::text)) STORED,
    optional_items jsonb GENERATED ALWAYS AS ((_raw_data -> 'optional_items'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    payment_link text GENERATED ALWAYS AS ((_raw_data ->> 'payment_link'::text)) STORED,
    payment_method_collection text GENERATED ALWAYS AS ((_raw_data ->> 'payment_method_collection'::text)) STORED,
    payment_method_configuration_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_configuration_details'::text)) STORED,
    payment_method_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_options'::text)) STORED,
    payment_method_types jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_types'::text)) STORED,
    payment_status text GENERATED ALWAYS AS ((_raw_data ->> 'payment_status'::text)) STORED,
    permissions jsonb GENERATED ALWAYS AS ((_raw_data -> 'permissions'::text)) STORED,
    phone_number_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'phone_number_collection'::text)) STORED,
    presentment_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'presentment_details'::text)) STORED,
    recovered_from text GENERATED ALWAYS AS ((_raw_data ->> 'recovered_from'::text)) STORED,
    redirect_on_completion text GENERATED ALWAYS AS ((_raw_data ->> 'redirect_on_completion'::text)) STORED,
    return_url text GENERATED ALWAYS AS ((_raw_data ->> 'return_url'::text)) STORED,
    saved_payment_method_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'saved_payment_method_options'::text)) STORED,
    setup_intent text GENERATED ALWAYS AS ((_raw_data ->> 'setup_intent'::text)) STORED,
    shipping_address_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_address_collection'::text)) STORED,
    shipping_cost jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_cost'::text)) STORED,
    shipping_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_details'::text)) STORED,
    shipping_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_options'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    submit_type text GENERATED ALWAYS AS ((_raw_data ->> 'submit_type'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    success_url text GENERATED ALWAYS AS ((_raw_data ->> 'success_url'::text)) STORED,
    tax_id_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'tax_id_collection'::text)) STORED,
    total_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'total_details'::text)) STORED,
    ui_mode text GENERATED ALWAYS AS ((_raw_data ->> 'ui_mode'::text)) STORED,
    url text GENERATED ALWAYS AS ((_raw_data ->> 'url'::text)) STORED,
    wallet_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'wallet_options'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.checkout_sessions OWNER TO postgres;

--
-- Name: coupons; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.coupons (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    valid boolean GENERATED ALWAYS AS (((_raw_data ->> 'valid'::text))::boolean) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    duration text GENERATED ALWAYS AS ((_raw_data ->> 'duration'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    redeem_by integer GENERATED ALWAYS AS (((_raw_data ->> 'redeem_by'::text))::integer) STORED,
    amount_off bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_off'::text))::bigint) STORED,
    percent_off double precision GENERATED ALWAYS AS (((_raw_data ->> 'percent_off'::text))::double precision) STORED,
    times_redeemed bigint GENERATED ALWAYS AS (((_raw_data ->> 'times_redeemed'::text))::bigint) STORED,
    max_redemptions bigint GENERATED ALWAYS AS (((_raw_data ->> 'max_redemptions'::text))::bigint) STORED,
    duration_in_months bigint GENERATED ALWAYS AS (((_raw_data ->> 'duration_in_months'::text))::bigint) STORED,
    percent_off_precise double precision GENERATED ALWAYS AS (((_raw_data ->> 'percent_off_precise'::text))::double precision) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.coupons OWNER TO postgres;

--
-- Name: credit_notes; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.credit_notes (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::integer) STORED,
    amount_shipping integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_shipping'::text))::integer) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    customer_balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'customer_balance_transaction'::text)) STORED,
    discount_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'discount_amount'::text))::integer) STORED,
    discount_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount_amounts'::text)) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    lines jsonb GENERATED ALWAYS AS ((_raw_data -> 'lines'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    memo text GENERATED ALWAYS AS ((_raw_data ->> 'memo'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    number text GENERATED ALWAYS AS ((_raw_data ->> 'number'::text)) STORED,
    out_of_band_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'out_of_band_amount'::text))::integer) STORED,
    pdf text GENERATED ALWAYS AS ((_raw_data ->> 'pdf'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    refund text GENERATED ALWAYS AS ((_raw_data ->> 'refund'::text)) STORED,
    shipping_cost jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_cost'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'subtotal'::text))::integer) STORED,
    subtotal_excluding_tax integer GENERATED ALWAYS AS (((_raw_data ->> 'subtotal_excluding_tax'::text))::integer) STORED,
    tax_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'tax_amounts'::text)) STORED,
    total integer GENERATED ALWAYS AS (((_raw_data ->> 'total'::text))::integer) STORED,
    total_excluding_tax integer GENERATED ALWAYS AS (((_raw_data ->> 'total_excluding_tax'::text))::integer) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    voided_at text GENERATED ALWAYS AS ((_raw_data ->> 'voided_at'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.credit_notes OWNER TO postgres;

--
-- Name: customers; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.customers (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    address jsonb GENERATED ALWAYS AS ((_raw_data -> 'address'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    email text GENERATED ALWAYS AS ((_raw_data ->> 'email'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    phone text GENERATED ALWAYS AS ((_raw_data ->> 'phone'::text)) STORED,
    shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping'::text)) STORED,
    balance integer GENERATED ALWAYS AS (((_raw_data ->> 'balance'::text))::integer) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    default_source text GENERATED ALWAYS AS ((_raw_data ->> 'default_source'::text)) STORED,
    delinquent boolean GENERATED ALWAYS AS (((_raw_data ->> 'delinquent'::text))::boolean) STORED,
    discount jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount'::text)) STORED,
    invoice_prefix text GENERATED ALWAYS AS ((_raw_data ->> 'invoice_prefix'::text)) STORED,
    invoice_settings jsonb GENERATED ALWAYS AS ((_raw_data -> 'invoice_settings'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    next_invoice_sequence integer GENERATED ALWAYS AS (((_raw_data ->> 'next_invoice_sequence'::text))::integer) STORED,
    preferred_locales jsonb GENERATED ALWAYS AS ((_raw_data -> 'preferred_locales'::text)) STORED,
    tax_exempt text GENERATED ALWAYS AS ((_raw_data ->> 'tax_exempt'::text)) STORED,
    deleted boolean GENERATED ALWAYS AS (((_raw_data ->> 'deleted'::text))::boolean) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.customers OWNER TO postgres;

--
-- Name: disputes; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.disputes (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    evidence jsonb GENERATED ALWAYS AS ((_raw_data -> 'evidence'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    evidence_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'evidence_details'::text)) STORED,
    balance_transactions jsonb GENERATED ALWAYS AS ((_raw_data -> 'balance_transactions'::text)) STORED,
    is_charge_refundable boolean GENERATED ALWAYS AS (((_raw_data ->> 'is_charge_refundable'::text))::boolean) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.disputes OWNER TO postgres;

--
-- Name: early_fraud_warnings; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.early_fraud_warnings (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    actionable boolean GENERATED ALWAYS AS (((_raw_data ->> 'actionable'::text))::boolean) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    fraud_type text GENERATED ALWAYS AS ((_raw_data ->> 'fraud_type'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.early_fraud_warnings OWNER TO postgres;

--
-- Name: events; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.events (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    data jsonb GENERATED ALWAYS AS ((_raw_data -> 'data'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    request text GENERATED ALWAYS AS ((_raw_data ->> 'request'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    api_version text GENERATED ALWAYS AS ((_raw_data ->> 'api_version'::text)) STORED,
    pending_webhooks bigint GENERATED ALWAYS AS (((_raw_data ->> 'pending_webhooks'::text))::bigint) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.events OWNER TO postgres;

--
-- Name: features; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.features (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    lookup_key text GENERATED ALWAYS AS ((_raw_data ->> 'lookup_key'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.features OWNER TO postgres;

--
-- Name: invoices; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.invoices (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    auto_advance boolean GENERATED ALWAYS AS (((_raw_data ->> 'auto_advance'::text))::boolean) STORED,
    collection_method text GENERATED ALWAYS AS ((_raw_data ->> 'collection_method'::text)) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    hosted_invoice_url text GENERATED ALWAYS AS ((_raw_data ->> 'hosted_invoice_url'::text)) STORED,
    lines jsonb GENERATED ALWAYS AS ((_raw_data -> 'lines'::text)) STORED,
    period_end integer GENERATED ALWAYS AS (((_raw_data ->> 'period_end'::text))::integer) STORED,
    period_start integer GENERATED ALWAYS AS (((_raw_data ->> 'period_start'::text))::integer) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    total bigint GENERATED ALWAYS AS (((_raw_data ->> 'total'::text))::bigint) STORED,
    account_country text GENERATED ALWAYS AS ((_raw_data ->> 'account_country'::text)) STORED,
    account_name text GENERATED ALWAYS AS ((_raw_data ->> 'account_name'::text)) STORED,
    account_tax_ids jsonb GENERATED ALWAYS AS ((_raw_data -> 'account_tax_ids'::text)) STORED,
    amount_due bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_due'::text))::bigint) STORED,
    amount_paid bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_paid'::text))::bigint) STORED,
    amount_remaining bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_remaining'::text))::bigint) STORED,
    application_fee_amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'application_fee_amount'::text))::bigint) STORED,
    attempt_count integer GENERATED ALWAYS AS (((_raw_data ->> 'attempt_count'::text))::integer) STORED,
    attempted boolean GENERATED ALWAYS AS (((_raw_data ->> 'attempted'::text))::boolean) STORED,
    billing_reason text GENERATED ALWAYS AS ((_raw_data ->> 'billing_reason'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    custom_fields jsonb GENERATED ALWAYS AS ((_raw_data -> 'custom_fields'::text)) STORED,
    customer_address jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_address'::text)) STORED,
    customer_email text GENERATED ALWAYS AS ((_raw_data ->> 'customer_email'::text)) STORED,
    customer_name text GENERATED ALWAYS AS ((_raw_data ->> 'customer_name'::text)) STORED,
    customer_phone text GENERATED ALWAYS AS ((_raw_data ->> 'customer_phone'::text)) STORED,
    customer_shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_shipping'::text)) STORED,
    customer_tax_exempt text GENERATED ALWAYS AS ((_raw_data ->> 'customer_tax_exempt'::text)) STORED,
    customer_tax_ids jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_tax_ids'::text)) STORED,
    default_tax_rates jsonb GENERATED ALWAYS AS ((_raw_data -> 'default_tax_rates'::text)) STORED,
    discount jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount'::text)) STORED,
    discounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'discounts'::text)) STORED,
    due_date integer GENERATED ALWAYS AS (((_raw_data ->> 'due_date'::text))::integer) STORED,
    ending_balance integer GENERATED ALWAYS AS (((_raw_data ->> 'ending_balance'::text))::integer) STORED,
    footer text GENERATED ALWAYS AS ((_raw_data ->> 'footer'::text)) STORED,
    invoice_pdf text GENERATED ALWAYS AS ((_raw_data ->> 'invoice_pdf'::text)) STORED,
    last_finalization_error jsonb GENERATED ALWAYS AS ((_raw_data -> 'last_finalization_error'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    next_payment_attempt integer GENERATED ALWAYS AS (((_raw_data ->> 'next_payment_attempt'::text))::integer) STORED,
    number text GENERATED ALWAYS AS ((_raw_data ->> 'number'::text)) STORED,
    paid boolean GENERATED ALWAYS AS (((_raw_data ->> 'paid'::text))::boolean) STORED,
    payment_settings jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_settings'::text)) STORED,
    post_payment_credit_notes_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'post_payment_credit_notes_amount'::text))::integer) STORED,
    pre_payment_credit_notes_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'pre_payment_credit_notes_amount'::text))::integer) STORED,
    receipt_number text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_number'::text)) STORED,
    starting_balance integer GENERATED ALWAYS AS (((_raw_data ->> 'starting_balance'::text))::integer) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    status_transitions jsonb GENERATED ALWAYS AS ((_raw_data -> 'status_transitions'::text)) STORED,
    subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'subtotal'::text))::integer) STORED,
    tax integer GENERATED ALWAYS AS (((_raw_data ->> 'tax'::text))::integer) STORED,
    total_discount_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'total_discount_amounts'::text)) STORED,
    total_tax_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'total_tax_amounts'::text)) STORED,
    transfer_data jsonb GENERATED ALWAYS AS ((_raw_data -> 'transfer_data'::text)) STORED,
    webhooks_delivered_at integer GENERATED ALWAYS AS (((_raw_data ->> 'webhooks_delivered_at'::text))::integer) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    default_payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'default_payment_method'::text)) STORED,
    default_source text GENERATED ALWAYS AS ((_raw_data ->> 'default_source'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.invoices OWNER TO postgres;

--
-- Name: payment_intents; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.payment_intents (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::integer) STORED,
    amount_capturable integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_capturable'::text))::integer) STORED,
    amount_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'amount_details'::text)) STORED,
    amount_received integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_received'::text))::integer) STORED,
    application text GENERATED ALWAYS AS ((_raw_data ->> 'application'::text)) STORED,
    application_fee_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'application_fee_amount'::text))::integer) STORED,
    automatic_payment_methods text GENERATED ALWAYS AS ((_raw_data ->> 'automatic_payment_methods'::text)) STORED,
    canceled_at integer GENERATED ALWAYS AS (((_raw_data ->> 'canceled_at'::text))::integer) STORED,
    cancellation_reason text GENERATED ALWAYS AS ((_raw_data ->> 'cancellation_reason'::text)) STORED,
    capture_method text GENERATED ALWAYS AS ((_raw_data ->> 'capture_method'::text)) STORED,
    client_secret text GENERATED ALWAYS AS ((_raw_data ->> 'client_secret'::text)) STORED,
    confirmation_method text GENERATED ALWAYS AS ((_raw_data ->> 'confirmation_method'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    last_payment_error text GENERATED ALWAYS AS ((_raw_data ->> 'last_payment_error'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    next_action text GENERATED ALWAYS AS ((_raw_data ->> 'next_action'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'payment_method'::text)) STORED,
    payment_method_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_options'::text)) STORED,
    payment_method_types jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_types'::text)) STORED,
    processing text GENERATED ALWAYS AS ((_raw_data ->> 'processing'::text)) STORED,
    receipt_email text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_email'::text)) STORED,
    review text GENERATED ALWAYS AS ((_raw_data ->> 'review'::text)) STORED,
    setup_future_usage text GENERATED ALWAYS AS ((_raw_data ->> 'setup_future_usage'::text)) STORED,
    shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping'::text)) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    statement_descriptor_suffix text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor_suffix'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    transfer_data jsonb GENERATED ALWAYS AS ((_raw_data -> 'transfer_data'::text)) STORED,
    transfer_group text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_group'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.payment_intents OWNER TO postgres;

--
-- Name: payment_methods; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.payment_methods (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    billing_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'billing_details'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    card jsonb GENERATED ALWAYS AS ((_raw_data -> 'card'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.payment_methods OWNER TO postgres;

--
-- Name: payouts; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.payouts (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    date text GENERATED ALWAYS AS ((_raw_data ->> 'date'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    method text GENERATED ALWAYS AS ((_raw_data ->> 'method'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    automatic boolean GENERATED ALWAYS AS (((_raw_data ->> 'automatic'::text))::boolean) STORED,
    recipient text GENERATED ALWAYS AS ((_raw_data ->> 'recipient'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    destination text GENERATED ALWAYS AS ((_raw_data ->> 'destination'::text)) STORED,
    source_type text GENERATED ALWAYS AS ((_raw_data ->> 'source_type'::text)) STORED,
    arrival_date text GENERATED ALWAYS AS ((_raw_data ->> 'arrival_date'::text)) STORED,
    bank_account jsonb GENERATED ALWAYS AS ((_raw_data -> 'bank_account'::text)) STORED,
    failure_code text GENERATED ALWAYS AS ((_raw_data ->> 'failure_code'::text)) STORED,
    transfer_group text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_group'::text)) STORED,
    amount_reversed bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_reversed'::text))::bigint) STORED,
    failure_message text GENERATED ALWAYS AS ((_raw_data ->> 'failure_message'::text)) STORED,
    source_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'source_transaction'::text)) STORED,
    balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'balance_transaction'::text)) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    statement_description text GENERATED ALWAYS AS ((_raw_data ->> 'statement_description'::text)) STORED,
    failure_balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'failure_balance_transaction'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.payouts OWNER TO postgres;

--
-- Name: plans; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.plans (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    tiers jsonb GENERATED ALWAYS AS ((_raw_data -> 'tiers'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    product text GENERATED ALWAYS AS ((_raw_data ->> 'product'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    "interval" text GENERATED ALWAYS AS ((_raw_data ->> 'interval'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    nickname text GENERATED ALWAYS AS ((_raw_data ->> 'nickname'::text)) STORED,
    tiers_mode text GENERATED ALWAYS AS ((_raw_data ->> 'tiers_mode'::text)) STORED,
    usage_type text GENERATED ALWAYS AS ((_raw_data ->> 'usage_type'::text)) STORED,
    billing_scheme text GENERATED ALWAYS AS ((_raw_data ->> 'billing_scheme'::text)) STORED,
    interval_count bigint GENERATED ALWAYS AS (((_raw_data ->> 'interval_count'::text))::bigint) STORED,
    aggregate_usage text GENERATED ALWAYS AS ((_raw_data ->> 'aggregate_usage'::text)) STORED,
    transform_usage text GENERATED ALWAYS AS ((_raw_data ->> 'transform_usage'::text)) STORED,
    trial_period_days bigint GENERATED ALWAYS AS (((_raw_data ->> 'trial_period_days'::text))::bigint) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    statement_description text GENERATED ALWAYS AS ((_raw_data ->> 'statement_description'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.plans OWNER TO postgres;

--
-- Name: prices; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.prices (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    nickname text GENERATED ALWAYS AS ((_raw_data ->> 'nickname'::text)) STORED,
    recurring jsonb GENERATED ALWAYS AS ((_raw_data -> 'recurring'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    unit_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'unit_amount'::text))::integer) STORED,
    billing_scheme text GENERATED ALWAYS AS ((_raw_data ->> 'billing_scheme'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    lookup_key text GENERATED ALWAYS AS ((_raw_data ->> 'lookup_key'::text)) STORED,
    tiers_mode text GENERATED ALWAYS AS ((_raw_data ->> 'tiers_mode'::text)) STORED,
    transform_quantity jsonb GENERATED ALWAYS AS ((_raw_data -> 'transform_quantity'::text)) STORED,
    unit_amount_decimal text GENERATED ALWAYS AS ((_raw_data ->> 'unit_amount_decimal'::text)) STORED,
    product text GENERATED ALWAYS AS ((_raw_data ->> 'product'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.prices OWNER TO postgres;

--
-- Name: products; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.products (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    default_price text GENERATED ALWAYS AS ((_raw_data ->> 'default_price'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    images jsonb GENERATED ALWAYS AS ((_raw_data -> 'images'::text)) STORED,
    marketing_features jsonb GENERATED ALWAYS AS ((_raw_data -> 'marketing_features'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    package_dimensions jsonb GENERATED ALWAYS AS ((_raw_data -> 'package_dimensions'::text)) STORED,
    shippable boolean GENERATED ALWAYS AS (((_raw_data ->> 'shippable'::text))::boolean) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    unit_label text GENERATED ALWAYS AS ((_raw_data ->> 'unit_label'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    url text GENERATED ALWAYS AS ((_raw_data ->> 'url'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.products OWNER TO postgres;

--
-- Name: refunds; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.refunds (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::integer) STORED,
    balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'balance_transaction'::text)) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    destination_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'destination_details'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    receipt_number text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_number'::text)) STORED,
    source_transfer_reversal text GENERATED ALWAYS AS ((_raw_data ->> 'source_transfer_reversal'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    transfer_reversal text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_reversal'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.refunds OWNER TO postgres;

--
-- Name: reviews; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.reviews (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    billing_zip text GENERATED ALWAYS AS ((_raw_data ->> 'billing_zip'::text)) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    closed_reason text GENERATED ALWAYS AS ((_raw_data ->> 'closed_reason'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    ip_address text GENERATED ALWAYS AS ((_raw_data ->> 'ip_address'::text)) STORED,
    ip_address_location jsonb GENERATED ALWAYS AS ((_raw_data -> 'ip_address_location'::text)) STORED,
    open boolean GENERATED ALWAYS AS (((_raw_data ->> 'open'::text))::boolean) STORED,
    opened_reason text GENERATED ALWAYS AS ((_raw_data ->> 'opened_reason'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    session text GENERATED ALWAYS AS ((_raw_data ->> 'session'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.reviews OWNER TO postgres;

--
-- Name: setup_intents; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.setup_intents (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'payment_method'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    usage text GENERATED ALWAYS AS ((_raw_data ->> 'usage'::text)) STORED,
    cancellation_reason text GENERATED ALWAYS AS ((_raw_data ->> 'cancellation_reason'::text)) STORED,
    latest_attempt text GENERATED ALWAYS AS ((_raw_data ->> 'latest_attempt'::text)) STORED,
    mandate text GENERATED ALWAYS AS ((_raw_data ->> 'mandate'::text)) STORED,
    single_use_mandate text GENERATED ALWAYS AS ((_raw_data ->> 'single_use_mandate'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.setup_intents OWNER TO postgres;

--
-- Name: subscription_items; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.subscription_items (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    billing_thresholds jsonb GENERATED ALWAYS AS ((_raw_data -> 'billing_thresholds'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    deleted boolean GENERATED ALWAYS AS (((_raw_data ->> 'deleted'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    quantity integer GENERATED ALWAYS AS (((_raw_data ->> 'quantity'::text))::integer) STORED,
    price text GENERATED ALWAYS AS ((_raw_data ->> 'price'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    tax_rates jsonb GENERATED ALWAYS AS ((_raw_data -> 'tax_rates'::text)) STORED,
    current_period_end integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_end'::text))::integer) STORED,
    current_period_start integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_start'::text))::integer) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.subscription_items OWNER TO postgres;

--
-- Name: subscription_schedules; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.subscription_schedules (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    application text GENERATED ALWAYS AS ((_raw_data ->> 'application'::text)) STORED,
    canceled_at integer GENERATED ALWAYS AS (((_raw_data ->> 'canceled_at'::text))::integer) STORED,
    completed_at integer GENERATED ALWAYS AS (((_raw_data ->> 'completed_at'::text))::integer) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    current_phase jsonb GENERATED ALWAYS AS ((_raw_data -> 'current_phase'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    default_settings jsonb GENERATED ALWAYS AS ((_raw_data -> 'default_settings'::text)) STORED,
    end_behavior text GENERATED ALWAYS AS ((_raw_data ->> 'end_behavior'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    phases jsonb GENERATED ALWAYS AS ((_raw_data -> 'phases'::text)) STORED,
    released_at integer GENERATED ALWAYS AS (((_raw_data ->> 'released_at'::text))::integer) STORED,
    released_subscription text GENERATED ALWAYS AS ((_raw_data ->> 'released_subscription'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    test_clock text GENERATED ALWAYS AS ((_raw_data ->> 'test_clock'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.subscription_schedules OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.subscriptions (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    cancel_at_period_end boolean GENERATED ALWAYS AS (((_raw_data ->> 'cancel_at_period_end'::text))::boolean) STORED,
    current_period_end integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_end'::text))::integer) STORED,
    current_period_start integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_start'::text))::integer) STORED,
    default_payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'default_payment_method'::text)) STORED,
    items jsonb GENERATED ALWAYS AS ((_raw_data -> 'items'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    pending_setup_intent text GENERATED ALWAYS AS ((_raw_data ->> 'pending_setup_intent'::text)) STORED,
    pending_update jsonb GENERATED ALWAYS AS ((_raw_data -> 'pending_update'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    application_fee_percent double precision GENERATED ALWAYS AS (((_raw_data ->> 'application_fee_percent'::text))::double precision) STORED,
    billing_cycle_anchor integer GENERATED ALWAYS AS (((_raw_data ->> 'billing_cycle_anchor'::text))::integer) STORED,
    billing_thresholds jsonb GENERATED ALWAYS AS ((_raw_data -> 'billing_thresholds'::text)) STORED,
    cancel_at integer GENERATED ALWAYS AS (((_raw_data ->> 'cancel_at'::text))::integer) STORED,
    canceled_at integer GENERATED ALWAYS AS (((_raw_data ->> 'canceled_at'::text))::integer) STORED,
    collection_method text GENERATED ALWAYS AS ((_raw_data ->> 'collection_method'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    days_until_due integer GENERATED ALWAYS AS (((_raw_data ->> 'days_until_due'::text))::integer) STORED,
    default_source text GENERATED ALWAYS AS ((_raw_data ->> 'default_source'::text)) STORED,
    default_tax_rates jsonb GENERATED ALWAYS AS ((_raw_data -> 'default_tax_rates'::text)) STORED,
    discount jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount'::text)) STORED,
    ended_at integer GENERATED ALWAYS AS (((_raw_data ->> 'ended_at'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    next_pending_invoice_item_invoice integer GENERATED ALWAYS AS (((_raw_data ->> 'next_pending_invoice_item_invoice'::text))::integer) STORED,
    pause_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'pause_collection'::text)) STORED,
    pending_invoice_item_interval jsonb GENERATED ALWAYS AS ((_raw_data -> 'pending_invoice_item_interval'::text)) STORED,
    start_date integer GENERATED ALWAYS AS (((_raw_data ->> 'start_date'::text))::integer) STORED,
    transfer_data jsonb GENERATED ALWAYS AS ((_raw_data -> 'transfer_data'::text)) STORED,
    trial_end jsonb GENERATED ALWAYS AS ((_raw_data -> 'trial_end'::text)) STORED,
    trial_start jsonb GENERATED ALWAYS AS ((_raw_data -> 'trial_start'::text)) STORED,
    schedule text GENERATED ALWAYS AS ((_raw_data ->> 'schedule'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    latest_invoice text GENERATED ALWAYS AS ((_raw_data ->> 'latest_invoice'::text)) STORED,
    plan text GENERATED ALWAYS AS ((_raw_data ->> 'plan'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.subscriptions OWNER TO postgres;

--
-- Name: tax_ids; Type: TABLE; Schema: stripe; Owner: postgres
--

CREATE TABLE stripe.tax_ids (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    country text GENERATED ALWAYS AS ((_raw_data ->> 'country'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    value text GENERATED ALWAYS AS ((_raw_data ->> 'value'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    owner jsonb GENERATED ALWAYS AS ((_raw_data -> 'owner'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


ALTER TABLE stripe.tax_ids OWNER TO postgres;

--
-- Name: daily_briefs_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_briefs_log ALTER COLUMN id SET DEFAULT nextval('public.daily_briefs_log_id_seq'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: referrals id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals ALTER COLUMN id SET DEFAULT nextval('public.referrals_id_seq'::regclass);


--
-- Name: user_alerts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_alerts ALTER COLUMN id SET DEFAULT nextval('public.user_alerts_id_seq'::regclass);


--
-- Name: webauthn_credentials id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webauthn_credentials ALTER COLUMN id SET DEFAULT nextval('public.webauthn_credentials_id_seq'::regclass);


--
-- Name: _sync_status id; Type: DEFAULT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._sync_status ALTER COLUMN id SET DEFAULT nextval('stripe._sync_status_id_seq'::regclass);


--
-- Data for Name: access_codes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.access_codes (id, code, label, type, active, created_at, used_by, used_at, expires_at, use_count, max_uses) FROM stdin;
d1693c43-2d0d-4fca-a2ad-aa0d7c85efc0	CLVR-VIP-FAMILY2	Family VIP #2	vip	t	2026-03-05 17:14:00.578574	\N	\N	2026-06-06 05:09:27.509	0	\N
ab284576-add2-48aa-8a2f-8347a7ca0654	CLVR-VIP-FAMILY3	Family VIP #3	vip	t	2026-03-05 17:14:00.582348	\N	\N	2026-06-06 05:09:27.509	0	\N
34c405f9-f69c-482c-ae48-9c3ab57b8eef	CLVR-VIP-FRIEND1	Friend VIP #1	vip	t	2026-03-05 17:14:00.586357	\N	\N	2026-06-06 05:09:27.509	0	\N
63cb69f8-bd64-4088-bb03-c03357491bd6	CLVR-VIP-FRIEND2	Friend VIP #2	vip	t	2026-03-05 17:14:00.590449	\N	\N	2026-06-06 05:09:27.509	0	\N
87c7332c-3b52-4b74-921f-67a836be926b	CLVR-VIP-FRIEND3	Friend VIP #3	vip	t	2026-03-05 17:14:00.594625	\N	\N	2026-06-06 05:09:27.509	0	\N
0774edb2-9866-433d-b0b8-e8a8be74b860	CLVR-VIP-FRIEND4	Friend VIP #4	vip	t	2026-03-05 17:14:00.598798	\N	\N	2026-06-06 05:09:27.509	0	\N
e0be9278-5bc1-4142-b92b-b64bec01641b	CLVR-VIP-FRIEND5	Friend VIP #5	vip	t	2026-03-05 17:14:00.602456	\N	\N	2026-06-06 05:09:27.509	0	\N
1eb1bf15-2358-41de-a7af-db0fe287d1f2	CLVR-VIP-FAMILY1	Family VIP #1	vip	t	2026-03-05 17:14:00.567711	77a0e92c-423e-48f7-a01b-1b95711f8c1b	2026-03-06 05:12:56.661755	2026-06-06 05:09:27.509	0	\N
b9901a65-b786-4eca-98d7-377bb9649c38	CLVR-VIP-DAHLYN	VIP — Dahlyn	vip	t	2026-03-06 05:32:21.865136	\N	\N	2026-06-06 05:32:21.756	0	\N
a1014d90-104b-4a24-ac34-6e43e4ce26df	CLVR-VIP-NANCY	VIP — Nancy	vip	t	2026-03-06 05:32:21.879222	\N	\N	2026-06-06 05:32:21.756	0	\N
3ebbcf06-966d-4ef0-8fe2-7371cbe00050	CLVR-FF-MIKE01	Friends & Family — Mike #1	vip	t	2026-03-10 23:38:34.626952	\N	\N	2026-04-10 23:38:30.383	0	\N
72f900b8-b695-4383-9365-d260f759ec30	CLVR-FF-MIKE02	Friends & Family — Mike #2	vip	t	2026-03-10 23:38:38.911913	\N	\N	2026-04-10 23:38:30.383	0	\N
18495adc-e58b-42e6-ba61-7d3620758661	CLVR-FF-MIKE03	Friends & Family — Mike #3	vip	t	2026-03-10 23:38:42.892246	\N	\N	2026-04-10 23:38:30.383	0	\N
4f3cfc65-9f77-415f-8595-83a9f075f067	CLVR-FF-MIKE04	Friends & Family — Mike #4	vip	t	2026-03-10 23:38:46.750677	\N	\N	2026-04-10 23:38:30.383	0	\N
1dbef5d9-a3df-438f-9696-01a217e241e0	CLVR-FF-MIKE05	Friends & Family — Mike #5	vip	t	2026-03-10 23:38:50.609991	\N	\N	2026-04-10 23:38:30.383	0	\N
98904b6a-1e01-4dd5-8162-c3b71ec1945c	CLVR-FF-GIFT01	Friends & Family — Gift #1	vip	t	2026-03-10 23:38:54.810397	\N	\N	2026-04-10 23:38:30.383	0	\N
ef8078dc-1b20-481d-9e9f-31a9aa2d1327	CLVR-FF-GIFT02	Friends & Family — Gift #2	vip	t	2026-03-10 23:38:58.724308	\N	\N	2026-04-10 23:38:30.383	0	\N
39e0cfc6-ccff-4b47-a1b2-35f111237866	CLVR-FF-GIFT03	Friends & Family — Gift #3	vip	t	2026-03-10 23:39:02.783872	\N	\N	2026-04-10 23:38:30.383	0	\N
6cdb4d6e-6573-41ee-a77a-835080823c46	CLVR-FF-GIFT04	Friends & Family — Gift #4	vip	t	2026-03-10 23:39:06.779969	\N	\N	2026-04-10 23:38:30.383	0	\N
4c0100e6-e233-4c7b-bc4e-29b465edc8bf	CLVR-FF-GIFT05	Friends & Family — Gift #5	vip	t	2026-03-10 23:39:10.642369	\N	\N	2026-04-10 23:38:30.383	0	\N
64040755-d6b3-4a9a-b8f5-26de08824cfa	CLVR-TRIAL-FAWDRFJD	Owner Trial — 7 Days Free Pro	trial	f	2026-03-12 13:10:48.435184	\N	\N	2026-03-19 13:10:48.433	0	1
0912afe5-ddbe-4b08-a19a-2a6bb7b62db3	CLVR-TRIAL-LCS6FCYG	Owner Trial — 7 Days Free Pro	trial	t	2026-03-14 05:15:23.383694	\N	\N	2026-03-21 05:15:23.383	0	1
1d54adc1-d73f-4b53-8079-3e50ad28faac	CLVR-VIP-YANN	VIP — Yann	vip	t	2026-03-06 05:32:21.823944	\N	\N	2026-03-21 16:13:19.191591	0	\N
2126a9c7-f44d-432d-b5c5-ed795f1bd9cd	CLVR-VIP-GROUP2026	Group VIP — Shared Code (1 month)	vip	t	2026-03-12 13:10:48.39419	\N	\N	2026-04-22 18:38:42.646	0	-1
f292adef-7bdc-404c-b667-5497d078e3c3	CLVR-TRIAL-P38E25WS	Owner Trial — 7 Days Free Pro	trial	t	2026-03-21 11:24:15.161201	\N	\N	2026-03-28 11:24:15.159	0	1
\.


--
-- Data for Name: daily_briefs_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.daily_briefs_log (id, date_key, sent_at, recipient_count) FROM stdin;
1	2026-03-16	2026-03-16 10:43:21.216851	4
2	2026-03-17	2026-03-17 12:52:45.391429	4
3	2026-03-18	2026-03-18 10:07:29.617629	4
4	2026-03-19	2026-03-19 13:51:22.66436	4
5	2026-03-20	2026-03-20 12:15:12.954269	0
6	2026-03-21	2026-03-21 11:24:25.182729	4
\.


--
-- Data for Name: push_subscriptions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.push_subscriptions (id, user_id, subscription, created_at) FROM stdin;
\.


--
-- Data for Name: referrals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.referrals (id, referrer_user_id, referred_user_id, status, reward_granted, created_at) FROM stdin;
\.


--
-- Data for Name: subscribers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscribers (id, email, name, active, created_at) FROM stdin;
5338e22a-708f-47cf-ad9f-f5714c9d6cba	test@example.com	Test User	t	2026-03-05 17:25:54.810231
7aa59c9b-50ee-48e2-a8ee-7d64f3ed3063	mike@clvrquant.com	Mike Claver	t	2026-03-05 17:34:15.796044
ab5e8504-62c7-4235-8b6e-6f064c1e1594	mikeclaver@gmail.com	Mike Claver	t	2026-03-06 04:18:23.063388
91b7718f-881e-490b-b1c7-4e26eed5aa2e	pauljack@gmail.com	Paul Jack	f	2026-03-13 20:22:44.38534
ff25ac3c-1b36-42ed-8433-973b5a302f5f	paul@gmail.com	Julie	t	2026-03-13 20:48:06.038814
\.


--
-- Data for Name: user_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_alerts (id, user_id, sym, field, condition, threshold, label, triggered, created_at, expires_at) FROM stdin;
1	fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc	BTC	price	above	100000	BTC price above $100000	f	2026-03-12 12:46:59.191847	2026-04-12 12:46:59.178
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_sessions (sid, sess, expire) FROM stdin;
OjBRl0eVECP3qql7j2wu6t74oeKxJx5l	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-18T19:25:38.951Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc"}	2026-04-18 19:25:39
tvt4DqM9XRjLkgmrQ2DKJDq_lyFrgbrX	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-16T13:34:19.800Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":"fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc"}	2026-04-21 05:15:03
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, password, stripe_customer_id, stripe_subscription_id, tier, email, name, subscribe_to_brief, created_at, reset_token, reset_token_expiry, promo_code, promo_expires_at, referral_code, referred_by, must_change_password, email_verified, email_verification_token) FROM stdin;
82857189-3e1b-4f2e-bdbf-e18aa985dc47	test@example.com	$2b$12$pTOUbb6L1t5nLL2zSiVcAO7iPTw85PYqTpLJty.WlItgWCJp1ykhK	\N	\N	free	test@example.com	Test User	f	2026-03-06 04:09:05.928128	\N	\N	\N	\N	\N	\N	f	f	\N
3384c9bd-d3cd-4952-a16e-715de4df81ca	qp73en@test.com	$2b$12$QgbC8izdEh81W5pV9XY0Ru/VDv5TUnaIBkB/f00cjGDFolqltdTRu	\N	\N	free	qp73en@test.com	Test Trader L3Pj	f	2026-03-06 04:11:23.644917	\N	\N	\N	\N	\N	\N	f	f	\N
77a0e92c-423e-48f7-a01b-1b95711f8c1b	aaksk3@codetest.com	$2b$12$e3Zpe1t97c5vwRIykJ/YyuzEIQymEoZ25liU2SZT3KIcymegUxycG	\N	\N	free	aaksk3@codetest.com	Code Tester meiL	f	2026-03-06 05:12:31.297577	\N	\N	\N	\N	\N	\N	f	f	\N
641acb45-1e36-49d8-aba7-ce2440158b6e	-32lkz@other.com	$2b$12$E3665Ae.gi6YDEVo3wA.ouvSBYIfVbi0kABgfyb0bIsE5cOWsVdmW	\N	\N	free	-32lkz@other.com	Other Tester 1jJ6	f	2026-03-06 05:13:42.273427	\N	\N	\N	\N	\N	\N	f	f	\N
7f7c3e5e-2246-4e9b-9e8b-200a20b6b9b3	test+2ijhem@example.com	$2b$12$/bI0dHG2leezqhyW3P.C0O35It08NHtTWAMO5s8zZKPvmOashOpcq	\N	\N	free	test+2ijhem@example.com	Test User	f	2026-03-10 16:10:40.874998	\N	\N	\N	\N	\N	\N	f	f	\N
68bf249b-481f-400d-a4fb-35efb4391d29	test-welcome-check@example.com	$2b$12$9XDNqGyA/INPSxxp7k512eTEAkKjOoEmIGaYn.SP9Ou5xGD.9Ypui	\N	\N	free	test-welcome-check@example.com	Test User	f	2026-03-11 00:52:52.869411	\N	\N	\N	\N	CLVR-REF-01A965	\N	f	f	\N
38e2d412-cc1f-499d-82c2-dbb977b257dc	logtest-welcome@example.com	$2b$12$n6oERHl6RtxctTF5uW9SLeBRKHwJ2/Dzr7WtCBks4oAmIcKPRFinm	\N	\N	free	logtest-welcome@example.com	Log Test	f	2026-03-11 00:53:25.569994	\N	\N	\N	\N	CLVR-REF-D3AC4C	\N	f	f	\N
fcab12e3-936c-4c26-af6c-993073b71811	emailtest-xyz@example.com	$2b$12$dj5maahj3LARrbRSZBzaSump2rv166BYspMp1c2UWxiM0uhohAMxy	\N	\N	free	emailtest-xyz@example.com	Email Test	f	2026-03-11 00:54:24.743716	\N	\N	\N	\N	CLVR-REF-14D6C4	\N	f	f	\N
6e01240b-725e-48c4-bc19-3921f013fab3	finaltest-abc@example.com	$2b$12$I5huRJpxla1MFwe053fp..4ULUPzYrKm2y1.EiUAUL6YOo234fEyy	\N	\N	free	finaltest-abc@example.com	Final Test	f	2026-03-11 00:54:55.501977	\N	\N	\N	\N	CLVR-REF-D84371	\N	f	f	\N
8eb11bde-9148-4998-af37-e60a8e96e9ec	delivery-test-777@example.com	$2b$12$eNeyeriYt24oUeRrTn8Z..m.TyGpZE3W9BUVCN8SJjWXBG3wxVRee	\N	\N	free	delivery-test-777@example.com	Delivery Test	f	2026-03-11 00:55:41.920778	\N	\N	\N	\N	CLVR-REF-0E7603	\N	f	f	\N
865b3edc-e6de-4713-839c-81f69345999a	domaintest-check@example.com	$2b$12$0NAY8C9TSbSD1O6AkvNH.uPBs/ts5oF/OjkrucKH5Z67/mzAIrtNm	\N	\N	free	domaintest-check@example.com	Domain Test	f	2026-03-11 01:29:33.989127	\N	\N	\N	\N	CLVR-REF-89E3EC	\N	f	f	\N
32532351-0455-44f2-a2e6-ead55bfc84c4	paul@gmail.com	$2b$12$krilfCW8bJEgu/IYajs0WurGlSNnNQrnhGuv54yzKUAjfoPX.IBGC	\N	\N	free	paul@gmail.com	Julie	t	2026-03-13 20:48:05.976193	\N	\N	\N	\N	CLVR-REF-A0D9F4	\N	f	f	e35daa3222bfd62d460c0c1df697174f9db9ddfe3d9d820e
fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc	mikeclaver@gmail.com	$2b$12$dPP/QFPe4px1jRJN98ay1.nOHz4wfcsOYdlgFGyFM8ZODmMjwoeUW	\N	\N	pro	mikeclaver@gmail.com	Mike Claver	t	2026-03-06 04:18:23.024365	ac0a98d42a85fc0ef1c3ff4d682da46a65692c7ebfba4aaeef773aa4070dc635	2026-03-12 15:03:55.73	\N	\N	\N	\N	t	f	\N
\.


--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.webauthn_credentials (id, user_id, credential_id, created_at) FROM stdin;
1	fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc	hZ8QZDfqHA/retvKDPEVvLKzVx8=	2026-03-13 20:07:00.783861
2	fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc	sgJ8zV1sOCav3Fq2eYbdmuoCW18=	2026-03-13 20:11:54.641103
3	fb7ce6a0-a770-4f17-af04-aa69ff9c4dfc	ks0/nx5LHLO6bOFdBSfago/7I4I=	2026-03-18 11:31:11.647653
\.


--
-- Data for Name: _managed_webhooks; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe._managed_webhooks (id, object, url, enabled_events, description, enabled, livemode, metadata, secret, status, api_version, created, updated_at, last_synced_at, account_id) FROM stdin;
we_1T7fIkDrlfg4CQPCeLRo506Z	webhook_endpoint	https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev/api/stripe/webhook	["charge.captured", "charge.dispute.closed", "charge.dispute.created", "charge.dispute.funds_reinstated", "charge.dispute.funds_withdrawn", "charge.dispute.updated", "charge.expired", "charge.failed", "charge.pending", "charge.refund.updated", "charge.refunded", "charge.succeeded", "charge.updated", "checkout.session.async_payment_failed", "checkout.session.async_payment_succeeded", "checkout.session.completed", "checkout.session.expired", "credit_note.created", "credit_note.updated", "credit_note.voided", "customer.created", "customer.deleted", "customer.subscription.created", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired", "customer.subscription.resumed", "customer.subscription.trial_will_end", "customer.subscription.updated", "customer.tax_id.created", "customer.tax_id.deleted", "customer.tax_id.updated", "customer.updated", "entitlements.active_entitlement_summary.updated", "invoice.created", "invoice.deleted", "invoice.finalization_failed", "invoice.finalized", "invoice.marked_uncollectible", "invoice.paid", "invoice.payment_action_required", "invoice.payment_failed", "invoice.payment_succeeded", "invoice.sent", "invoice.upcoming", "invoice.updated", "invoice.voided", "payment_intent.amount_capturable_updated", "payment_intent.canceled", "payment_intent.created", "payment_intent.partially_funded", "payment_intent.payment_failed", "payment_intent.processing", "payment_intent.requires_action", "payment_intent.succeeded", "payment_method.attached", "payment_method.automatically_updated", "payment_method.card_automatically_updated", "payment_method.detached", "payment_method.updated", "plan.created", "plan.deleted", "plan.updated", "price.created", "price.deleted", "price.updated", "product.created", "product.deleted", "product.updated", "radar.early_fraud_warning.created", "radar.early_fraud_warning.updated", "refund.created", "refund.failed", "refund.updated", "review.closed", "review.opened", "setup_intent.canceled", "setup_intent.created", "setup_intent.requires_action", "setup_intent.setup_failed", "setup_intent.succeeded", "subscription_schedule.aborted", "subscription_schedule.canceled", "subscription_schedule.completed", "subscription_schedule.created", "subscription_schedule.expiring", "subscription_schedule.released", "subscription_schedule.updated"]	\N	\N	f	{"managed_by": "stripe-sync"}	whsec_1nvetuZeMedMmLwhJkXoch5UZKiO9ZZF	enabled	\N	1772730186	2026-03-05 17:03:06.25709+00	2026-03-05 17:03:06.256+00	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: _migrations; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe._migrations (id, name, hash, executed_at) FROM stdin;
0	initial_migration	c18983eedaa79cc2f6d92727d70c4f772256ef3d	2026-03-05 17:02:56.027332
1	products	b99ffc23df668166b94156f438bfa41818d4e80c	2026-03-05 17:02:56.03238
2	customers	33e481247ddc217f4e27ad10dfe5430097981670	2026-03-05 17:02:56.044548
3	prices	7d5ff35640651606cc24cec8a73ff7c02492ecdf	2026-03-05 17:02:56.053055
4	subscriptions	2cc6121a943c2a623c604e5ab12118a57a6c329a	2026-03-05 17:02:56.068725
5	invoices	7fbb4ccb4ed76a830552520739aaa163559771b1	2026-03-05 17:02:56.080377
6	charges	fb284ed969f033f5ce19f479b7a7e27871bddf09	2026-03-05 17:02:56.091336
7	coupons	7ed6ec4133f120675fd7888c0477b6281743fede	2026-03-05 17:02:56.099215
8	disputes	29bdb083725efe84252647f043f5f91cd0dabf43	2026-03-05 17:02:56.10766
9	events	b28cb55b5b69a9f52ef519260210cd76eea3c84e	2026-03-05 17:02:56.117583
10	payouts	69d1050b88bba1024cea4a671f9633ce7bfe25ff	2026-03-05 17:02:56.12782
11	plans	fc1ae945e86d1222a59cbcd3ae7e81a3a282a60c	2026-03-05 17:02:56.136313
12	add_updated_at	1d80945ef050a17a26e35e9983a58178262470f2	2026-03-05 17:02:56.14427
13	add_subscription_items	2aa63409bfe910add833155ad7468cdab844e0f1	2026-03-05 17:02:56.154568
14	migrate_subscription_items	8c2a798b44a8a0d83ede6f50ea7113064ecc1807	2026-03-05 17:02:56.164322
15	add_customer_deleted	6886ddfd8c129d3c4b39b59519f92618b397b395	2026-03-05 17:02:56.168858
16	add_invoice_indexes	d6bb9a09d5bdf580986ed14f55db71227a4d356d	2026-03-05 17:02:56.172838
17	drop_charges_unavailable_columns	61cd5adec4ae2c308d2c33d1b0ed203c7d074d6a	2026-03-05 17:02:56.181104
18	setup_intents	1d45d0fa47fc145f636c9e3c1ea692417fbb870d	2026-03-05 17:02:56.18862
19	payment_methods	705bdb15b50f1a97260b4f243008b8a34d23fb09	2026-03-05 17:02:56.199356
20	disputes_payment_intent_created_idx	18b2cecd7c097a7ea3b3f125f228e8790288d5ca	2026-03-05 17:02:56.208962
21	payment_intent	b1f194ff521b373c4c7cf220c0feadc253ebff0b	2026-03-05 17:02:56.214998
22	adjust_plans	e4eae536b0bc98ee14d78e818003952636ee877c	2026-03-05 17:02:56.229146
23	invoice_deleted	78e864c3146174fee7d08f05226b02d931d5b2ae	2026-03-05 17:02:56.232788
24	subscription_schedules	85fa6adb3815619bb17e1dafb00956ff548f7332	2026-03-05 17:02:56.235828
25	tax_ids	3f9a1163533f9e60a53d61dae5e451ab937584d9	2026-03-05 17:02:56.245219
26	credit_notes	e099b6b04ee607ee868d82af5193373c3fc266d2	2026-03-05 17:02:56.261731
27	add_marketing_features_to_products	6ed1774b0a9606c5937b2385d61057408193e8a7	2026-03-05 17:02:56.278726
28	early_fraud_warning	e615b0b73fa13d3b0508a1956d496d516f0ebf40	2026-03-05 17:02:56.282713
29	reviews	dd3f914139725a7934dc1062de4cc05aece77aea	2026-03-05 17:02:56.297828
30	refunds	f76c4e273eccdc96616424d73967a9bea3baac4e	2026-03-05 17:02:56.314892
31	add_default_price	6d10566a68bc632831fa25332727d8ff842caec5	2026-03-05 17:02:56.330098
32	update_subscription_items	e894858d46840ba4be5ea093cdc150728bd1d66f	2026-03-05 17:02:56.333364
33	add_last_synced_at	43124eb65b18b70c54d57d2b4fcd5dae718a200f	2026-03-05 17:02:56.336906
34	remove_foreign_keys	e72ec19f3232cf6e6b7308ebab80341c2341745f	2026-03-05 17:02:56.342438
35	checkout_sessions	dc294f5bb1a4d613be695160b38a714986800a75	2026-03-05 17:02:56.347285
36	checkout_session_line_items	82c8cfce86d68db63a9fa8de973bfe60c91342dd	2026-03-05 17:02:56.367484
37	add_features	c68a2c2b7e3808eed28c8828b2ffd3a2c9bf2bd4	2026-03-05 17:02:56.383189
38	active_entitlement	5b3858e7a52212b01e7f338cf08e29767ab362af	2026-03-05 17:02:56.395005
39	add_paused_to_subscription_status	09012b5d128f6ba25b0c8f69a1203546cf1c9f10	2026-03-05 17:02:56.415509
40	managed_webhooks	1d453dfd0e27ff0c2de97955c4ec03919af0af7f	2026-03-05 17:02:56.419163
41	rename_managed_webhooks	ad7cd1e4971a50790bf997cd157f3403d294484f	2026-03-05 17:02:56.442165
42	convert_to_jsonb_generated_columns	e0703a0e5cd9d97db53d773ada1983553e37813c	2026-03-05 17:02:56.445932
43	add_account_id	9a6beffdd0972e3657b7118b2c5001be1f815faf	2026-03-05 17:03:00.827153
44	make_account_id_required	05c1e9145220e905e0c1ca5329851acaf7e9e506	2026-03-05 17:03:00.836095
45	sync_status	2f88c4883fa885a6eaa23b8b02da958ca77a1c21	2026-03-05 17:03:00.847081
46	sync_status_per_account	b1f1f3d4fdb4b4cf4e489d4b195c7f0f97f9f27c	2026-03-05 17:03:00.858809
47	api_key_hashes	8046e4c57544b8eae277b057d201a28a4529ffe3	2026-03-05 17:03:00.887747
48	rename_reserved_columns	e32290f655550ed308a7f2dcb5b0114e49a0558e	2026-03-05 17:03:00.892199
49	remove_redundant_underscores_from_metadata_tables	96d6f3a54e17d8e19abd022a030a95a6161bf73e	2026-03-05 17:03:05.111318
50	rename_id_to_match_stripe_api	c5300c5a10081c033dab9961f4e3cd6a2440c2b6	2026-03-05 17:03:05.128127
51	remove_webhook_uuid	289bee08167858dbf4d04ca184f42681660ebb66	2026-03-05 17:03:05.4118
52	webhook_url_uniqueness	d02aec1815ce3a108b8a1def1ff24e865b26db70	2026-03-05 17:03:05.41616
\.


--
-- Data for Name: _sync_status; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe._sync_status (id, resource, status, last_synced_at, last_incremental_cursor, error_message, updated_at, account_id) FROM stdin;
\.


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.accounts (_raw_data, first_synced_at, _last_synced_at, _updated_at, api_key_hashes) FROM stdin;
{"id": "acct_1T7f81Drlfg4CQPC", "type": "standard", "email": null, "object": "account", "country": "US", "settings": {"payouts": {"schedule": {"interval": "daily", "delay_days": 2}, "statement_descriptor": null, "debit_negative_balances": true}, "branding": {"icon": null, "logo": null, "primary_color": null, "secondary_color": null}, "invoices": {"default_account_tax_ids": null, "hosted_payment_method_save": "offer"}, "payments": {"statement_descriptor": null, "statement_descriptor_kana": null, "statement_descriptor_kanji": null}, "dashboard": {"timezone": "Etc/UTC", "display_name": "Alpha Scan Sandbox"}, "card_issuing": {"tos_acceptance": {"ip": null, "date": null}}, "card_payments": {"statement_descriptor_prefix": null, "statement_descriptor_prefix_kana": null, "statement_descriptor_prefix_kanji": null}, "bacs_debit_payments": {"display_name": null, "service_user_number": null}, "sepa_debit_payments": {}}, "controller": {"type": "account"}, "capabilities": {}, "business_type": null, "charges_enabled": false, "payouts_enabled": false, "business_profile": {"mcc": null, "url": null, "name": null, "support_url": null, "support_email": null, "support_phone": null, "annual_revenue": null, "support_address": null, "estimated_worker_count": null, "minority_owned_business_designation": null}, "default_currency": "usd", "details_submitted": false}	2026-03-05 17:03:05.977161+00	2026-03-05 17:03:05.977161+00	2026-03-05 17:03:05.977161+00	{2c61edff54dc4c6d0ec85fc6b41dd5e6d61c7a4faff64d682c7f30e3ba917178}
\.


--
-- Data for Name: active_entitlements; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.active_entitlements (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: charges; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.charges (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:37:26.085143+00	2026-03-05 17:37:23+00	{"id": "ch_3T7fpuDrlfg4CQPC4Yk8EcFP", "paid": true, "order": null, "amount": 2900, "object": "charge", "review": null, "source": null, "status": "succeeded", "created": 1772732242, "dispute": null, "outcome": {"type": "authorized", "reason": null, "risk_level": "normal", "risk_score": 18, "advice_code": null, "network_status": "approved_by_network", "seller_message": "Payment complete.", "network_advice_code": null, "network_decline_code": null}, "captured": true, "currency": "usd", "customer": "cus_U5rZNyf7DNdnQ2", "disputed": false, "livemode": false, "metadata": {}, "refunded": false, "shipping": null, "application": null, "description": "Subscription creation", "destination": null, "receipt_url": "https://pay.stripe.com/receipts/invoices/CAcaFwoVYWNjdF8xVDdmODFEcmxmZzRDUVBDKNX-ps0GMgYdvb18yKo6LBYWRHm9P0KEDQJzh5OXVBgId-9zOkQl-hoAjuu-0Ax1zu4ItQGAk-r5A3ut?s=ap", "failure_code": null, "on_behalf_of": null, "fraud_details": {}, "radar_options": {}, "receipt_email": null, "transfer_data": null, "payment_intent": "pi_3T7fpuDrlfg4CQPC4aSPQ9vH", "payment_method": "pm_1T7fptDrlfg4CQPC7IZiv22x", "receipt_number": null, "transfer_group": null, "amount_captured": 2900, "amount_refunded": 0, "application_fee": null, "billing_details": {"name": "Mike C Mab", "email": "mikeclaver@gmail.com", "phone": null, "tax_id": null, "address": {"city": null, "line1": null, "line2": null, "state": null, "country": "CA", "postal_code": "M5V 1M3"}}, "failure_message": null, "source_transfer": null, "balance_transaction": "txn_3T7fpuDrlfg4CQPC487HBc93", "presentment_details": {"presentment_amount": 4129, "presentment_currency": "cad"}, "statement_descriptor": null, "application_fee_amount": null, "payment_method_details": {"card": {"brand": "visa", "last4": "4242", "checks": {"cvc_check": "pass", "address_line1_check": null, "address_postal_code_check": "pass"}, "wallet": null, "country": "US", "funding": "credit", "mandate": null, "network": "visa", "exp_year": 2027, "exp_month": 12, "fingerprint": "KFzXDwOamTOnhmhW", "overcapture": {"status": "unavailable", "maximum_amount_capturable": 2900}, "installments": null, "multicapture": {"status": "unavailable"}, "network_token": {"used": false}, "three_d_secure": null, "regulated_status": "unregulated", "amount_authorized": 2900, "authorization_code": "813256", "extended_authorization": {"status": "disabled"}, "network_transaction_id": "757012288681197", "incremental_authorization": {"status": "unavailable"}}, "type": "card"}, "failure_balance_transaction": null, "statement_descriptor_suffix": null, "calculated_statement_descriptor": "Stripe"}	acct_1T7f81Drlfg4CQPC
2026-03-05 19:40:26.08944+00	2026-03-05 19:40:23+00	{"id": "ch_3T7hkwDrlfg4CQPC391IQ47i", "paid": true, "order": null, "amount": 2900, "object": "charge", "review": null, "source": null, "status": "succeeded", "created": 1772739623, "dispute": null, "outcome": {"type": "authorized", "reason": null, "risk_level": "normal", "risk_score": 36, "advice_code": null, "network_status": "approved_by_network", "seller_message": "Payment complete.", "network_advice_code": null, "network_decline_code": null}, "captured": true, "currency": "usd", "customer": "cus_U5tYVPy20HEx9V", "disputed": false, "livemode": false, "metadata": {}, "refunded": false, "shipping": null, "application": null, "description": "Subscription creation", "destination": null, "receipt_url": "https://pay.stripe.com/receipts/invoices/CAcaFwoVYWNjdF8xVDdmODFEcmxmZzRDUVBDKKm4p80GMgaSkEp3hgE6LBbJkyGOuvd9NZlSpYN_pmF435-XSStEdcyx59lX4LX6OxejEFLo8b49_kkM?s=ap", "failure_code": null, "on_behalf_of": null, "fraud_details": {}, "radar_options": {}, "receipt_email": null, "transfer_data": null, "payment_intent": "pi_3T7hkwDrlfg4CQPC30Nxls0K", "payment_method": "pm_1T7hkvDrlfg4CQPC5DShMPeu", "receipt_number": null, "transfer_group": null, "amount_captured": 2900, "amount_refunded": 0, "application_fee": null, "billing_details": {"name": "mike c maba", "email": "mikeclaver@gmail.com", "phone": null, "tax_id": null, "address": {"city": null, "line1": null, "line2": null, "state": null, "country": "CA", "postal_code": "M5V 1M3"}}, "failure_message": null, "source_transfer": null, "balance_transaction": "txn_3T7hkwDrlfg4CQPC34zD0wFt", "statement_descriptor": null, "application_fee_amount": null, "payment_method_details": {"card": {"brand": "visa", "last4": "4242", "checks": {"cvc_check": "pass", "address_line1_check": null, "address_postal_code_check": "pass"}, "wallet": null, "country": "US", "funding": "credit", "mandate": null, "network": "visa", "exp_year": 2029, "exp_month": 8, "fingerprint": "KFzXDwOamTOnhmhW", "overcapture": {"status": "unavailable", "maximum_amount_capturable": 2900}, "installments": null, "multicapture": {"status": "unavailable"}, "network_token": {"used": false}, "three_d_secure": null, "regulated_status": "unregulated", "amount_authorized": 2900, "authorization_code": "052531", "extended_authorization": {"status": "disabled"}, "network_transaction_id": "757012288681197", "incremental_authorization": {"status": "unavailable"}}, "type": "card"}, "failure_balance_transaction": null, "statement_descriptor_suffix": null, "calculated_statement_descriptor": "ALPHA SCAN SANDBOX"}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: checkout_session_line_items; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.checkout_session_line_items (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:37:26.749928+00	2026-03-05 17:37:26+00	{"id": "li_1T7foGDrlfg4CQPCF5mzFTk1", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1xas2OxJfSVt35Ph42fuZU4wSVECLPMTrdSZcXGYZTUr6IEOUwmrM5ste", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-05 19:40:26.430553+00	2026-03-05 19:40:25+00	{"id": "li_1T7hjwDrlfg4CQPCEJ5c1XC1", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1qTUJtzjZgZRIX67qWsqIOy1MEOG3QhDv6X6dmmr4ipGcncDhMBF4VOIv", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 17:17:12.065314+00	2026-03-06 17:17:11+00	{"id": "li_1T7fWNDrlfg4CQPCnj7djld2", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1l8Yhvsx0E54zkMrwhotvPZTCPyOJQOY3dBaeI3ij1oktkivdBbNVbn13", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 17:17:30.843987+00	2026-03-06 17:17:30+00	{"id": "li_1T7fWgDrlfg4CQPC1l2MSg4u", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1Td0agoixk0UjxyJg4VYuNNXnNVFQs9oQyK660lb8HlMORWDQASO1SQvd", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 18:40:39.516683+00	2026-03-06 17:40:17+00	{"id": "li_1T7fsjDrlfg4CQPCz8Q1bLF1", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a11JUP5kVAuIlVqeUrMDWmHEj3qqKkfAn5091kKJEaHQ4WqcsPzeX2KPh4", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 19:36:51.974062+00	2026-03-06 19:36:51+00	{"id": "li_1T7hhXDrlfg4CQPCwKXhiUps", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a170X17Kndb4hNrKGJLYtsnNMEVaRNenqPWDIQTTO3WGk7rrPe0pUowPoJ", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 20:23:50.192226+00	2026-03-06 20:23:49+00	{"id": "li_1T7iQzDrlfg4CQPCVXlP8npU", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1G6CTJ48VbTx5phQgaZruLqcJtd2bfziqme2KZiBEoXjQUl2EregNzZME", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 20:25:09.789122+00	2026-03-06 20:25:09+00	{"id": "li_1T7iSHDrlfg4CQPCZNLzEXoc", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1s2TnDAXtWDbBggROZb3EgIrt5N72PbOs2krAhFG2M8Y8ZrwEDqmEa6xL", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
2026-03-06 20:44:57.853001+00	2026-03-06 20:44:57+00	{"id": "li_1T7ilRDrlfg4CQPCqPXEoxUK", "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "item", "currency": "usd", "metadata": {}, "quantity": 1, "amount_tax": 0, "description": "CLVRQuant Pro", "amount_total": 2900, "amount_discount": 0, "amount_subtotal": 2900, "checkout_session": "cs_test_a1UpOOnPOLcanEI6ye9ffg7VTZhGBNaJ7XpxU7oiYTezutOJMfC4kJMHWR", "adjustable_quantity": null}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: checkout_sessions; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.checkout_sessions (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-06 17:17:11.590011+00	2026-03-06 17:17:11+00	{"id": "cs_test_a1l8Yhvsx0E54zkMrwhotvPZTCPyOJQOY3dBaeI3ij1oktkivdBbNVbn13", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772731031, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772817431, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": null, "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": null, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "presentment_details": {"presentment_amount": 4129, "presentment_currency": "cad"}, "payment_method_types": ["card", "link"], "allow_promotion_codes": null, "collected_information": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": {"id": "pmc_1T7f8ZDrlfg4CQPCuHQRz8m2", "parent": null}}	acct_1T7f81Drlfg4CQPC
2026-03-06 17:17:30.752426+00	2026-03-06 17:17:30+00	{"id": "cs_test_a1Td0agoixk0UjxyJg4VYuNNXnNVFQs9oQyK660lb8HlMORWDQASO1SQvd", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772731051, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772817450, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": null, "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": null, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "presentment_details": {"presentment_amount": 4129, "presentment_currency": "cad"}, "payment_method_types": ["card", "link"], "allow_promotion_codes": null, "collected_information": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": {"id": "pmc_1T7f8ZDrlfg4CQPCuHQRz8m2", "parent": null}}	acct_1T7f81Drlfg4CQPC
2026-03-06 18:40:38.499203+00	2026-03-06 17:40:17+00	{"id": "cs_test_a11JUP5kVAuIlVqeUrMDWmHEj3qqKkfAn5091kKJEaHQ4WqcsPzeX2KPh4", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772732417, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772818817, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": null, "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": null, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "payment_method_types": ["card", "klarna", "link", "cashapp", "amazon_pay"], "allow_promotion_codes": null, "collected_information": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": {"id": "pmc_1T7f8ZDrlfg4CQPCuHQRz8m2", "parent": null}}	acct_1T7f81Drlfg4CQPC
2026-03-06 19:36:51.515425+00	2026-03-06 19:36:51+00	{"id": "cs_test_a170X17Kndb4hNrKGJLYtsnNMEVaRNenqPWDIQTTO3WGk7rrPe0pUowPoJ", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772739411, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772825811, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": "test-verify@clvrquant.com", "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": {"name": null, "email": "test-verify@clvrquant.com", "phone": null, "address": null, "tax_ids": null, "tax_exempt": "none", "business_name": null, "individual_name": null}, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "payment_method_types": ["card", "link"], "allow_promotion_codes": null, "collected_information": {"business_name": null, "individual_name": null, "shipping_details": null}, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": {"id": "pmc_1T7f8ZDrlfg4CQPCuHQRz8m2", "parent": null}}	acct_1T7f81Drlfg4CQPC
2026-03-06 20:23:49.804595+00	2026-03-06 20:23:49+00	{"id": "cs_test_a1G6CTJ48VbTx5phQgaZruLqcJtd2bfziqme2KZiBEoXjQUl2EregNzZME", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772742229, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772828629, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": null, "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": null, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "payment_method_types": ["card", "link"], "allow_promotion_codes": null, "collected_information": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": {"id": "pmc_1T7f8ZDrlfg4CQPCuHQRz8m2", "parent": null}}	acct_1T7f81Drlfg4CQPC
2026-03-06 20:25:09.660917+00	2026-03-06 20:25:09+00	{"id": "cs_test_a1s2TnDAXtWDbBggROZb3EgIrt5N72PbOs2krAhFG2M8Y8ZrwEDqmEa6xL", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772742309, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772828709, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": null, "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": null, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "payment_method_types": ["card", "link"], "allow_promotion_codes": null, "collected_information": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": {"id": "pmc_1T7f8ZDrlfg4CQPCuHQRz8m2", "parent": null}}	acct_1T7f81Drlfg4CQPC
2026-03-06 20:44:57.516025+00	2026-03-06 20:44:57+00	{"id": "cs_test_a1UpOOnPOLcanEI6ye9ffg7VTZhGBNaJ7XpxU7oiYTezutOJMfC4kJMHWR", "url": null, "mode": "subscription", "locale": null, "object": "checkout.session", "status": "expired", "consent": null, "created": 1772743497, "invoice": null, "ui_mode": "hosted", "currency": "usd", "customer": null, "livemode": false, "metadata": {}, "discounts": [], "cancel_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?status=cancel", "expires_at": 1772829897, "custom_text": {"submit": null, "after_submit": null, "shipping_address": null, "terms_of_service_acceptance": null}, "permissions": null, "submit_type": null, "success_url": "https://3de2fd41-f504-4eaf-ba65-878dcd6b576e-00-3sh2xabk7aca8.spock.replit.dev?session_id={CHECKOUT_SESSION_ID}&status=success", "amount_total": 2900, "payment_link": null, "setup_intent": null, "subscription": null, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null}, "client_secret": null, "custom_fields": [], "shipping_cost": null, "total_details": {"amount_tax": 0, "amount_discount": 0, "amount_shipping": 0}, "customer_email": null, "origin_context": null, "payment_intent": null, "payment_status": "unpaid", "recovered_from": null, "wallet_options": null, "amount_subtotal": 2900, "adaptive_pricing": {"enabled": true}, "after_expiration": null, "customer_account": null, "customer_details": null, "invoice_creation": null, "shipping_options": [], "branding_settings": {"icon": null, "logo": null, "font_family": "default", "border_style": "rounded", "button_color": "#0074d4", "display_name": "Alpha Scan Sandbox", "background_color": "#ffffff"}, "customer_creation": "always", "consent_collection": null, "client_reference_id": null, "currency_conversion": null, "payment_method_types": ["card"], "allow_promotion_codes": null, "collected_information": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}}, "phone_number_collection": {"enabled": false}, "payment_method_collection": "always", "billing_address_collection": null, "shipping_address_collection": null, "saved_payment_method_options": {"payment_method_save": null, "payment_method_remove": "disabled", "allow_redisplay_filters": ["always"]}, "payment_method_configuration_details": null}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: coupons; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.coupons (_updated_at, _last_synced_at, _raw_data) FROM stdin;
\.


--
-- Data for Name: credit_notes; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.credit_notes (_last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.customers (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: disputes; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.disputes (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: early_fraud_warnings; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.early_fraud_warnings (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: events; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.events (_updated_at, _last_synced_at, _raw_data) FROM stdin;
\.


--
-- Data for Name: features; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.features (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.invoices (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:37:26.743617+00	2026-03-05 17:37:24+00	{"id": "in_1T7fpuDrlfg4CQPCa9EaAjol", "lines": {"url": "/v1/invoices/in_1T7fpuDrlfg4CQPCa9EaAjol/lines", "data": [{"id": "il_1T7fptDrlfg4CQPCe64Sjllb", "taxes": [], "amount": 2900, "object": "line_item", "parent": {"type": "subscription_item_details", "invoice_item_details": null, "subscription_item_details": {"proration": false, "invoice_item": null, "subscription": "sub_1T7fpwDrlfg4CQPCKOXDVn5i", "proration_details": {"credited_items": null}, "subscription_item": "si_U5rZstNeAiXZML"}}, "period": {"end": 1775410641, "start": 1772732241}, "invoice": "in_1T7fpuDrlfg4CQPCa9EaAjol", "pricing": {"type": "price_details", "price_details": {"price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "product": "prod_U5r0eZMxeY4zkz"}, "unit_amount_decimal": "2900"}, "currency": "usd", "livemode": false, "metadata": {}, "quantity": 1, "subtotal": 2900, "discounts": [], "description": "1 × CLVRQuant Pro (at $29.00 / month)", "discountable": true, "discount_amounts": [], "pretax_credit_amounts": []}], "object": "list", "has_more": false, "total_count": 1}, "total": 2900, "footer": null, "issuer": {"type": "self"}, "number": "W8TMGSAL-0001", "object": "invoice", "parent": {"type": "subscription_details", "quote_details": null, "subscription_details": {"metadata": {}, "subscription": "sub_1T7fpwDrlfg4CQPCKOXDVn5i"}}, "status": "paid", "created": 1772732241, "currency": "usd", "customer": "cus_U5rZNyf7DNdnQ2", "due_date": null, "livemode": false, "metadata": {}, "subtotal": 2900, "attempted": true, "discounts": [], "rendering": null, "amount_due": 2900, "period_end": 1772732241, "test_clock": null, "amount_paid": 2900, "application": null, "description": null, "invoice_pdf": "https://pay.stripe.com/invoice/acct_1T7f81Drlfg4CQPC/test_YWNjdF8xVDdmODFEcmxmZzRDUVBDLF9VNXJaU05KRFRQaGEwWFk0bktYVTRHcEJmYTFyR3Z6LDE2MzI3MzA0Ng0200FIW2i7oA/pdf?s=ap", "total_taxes": [], "account_name": "Alpha Scan Sandbox", "auto_advance": false, "effective_at": 1772732241, "from_invoice": null, "on_behalf_of": null, "period_start": 1772732241, "attempt_count": 0, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null, "disabled_reason": null}, "custom_fields": null, "customer_name": "Mike C Mab", "shipping_cost": null, "billing_reason": "subscription_create", "customer_email": "mikeclaver@gmail.com", "customer_phone": null, "default_source": null, "ending_balance": 0, "receipt_number": null, "account_country": "US", "account_tax_ids": null, "amount_overpaid": 0, "amount_shipping": 0, "latest_revision": null, "amount_remaining": 0, "customer_account": null, "customer_address": {"city": null, "line1": null, "line2": null, "state": null, "country": "CA", "postal_code": "M5V 1M3"}, "customer_tax_ids": [], "payment_settings": {"default_mandate": null, "payment_method_types": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}, "payto": null, "konbini": null, "acss_debit": null, "bancontact": null, "sepa_debit": null, "us_bank_account": null, "customer_balance": null}}, "shipping_details": null, "starting_balance": 0, "collection_method": "charge_automatically", "customer_shipping": null, "default_tax_rates": [], "hosted_invoice_url": "https://invoice.stripe.com/i/acct_1T7f81Drlfg4CQPC/test_YWNjdF8xVDdmODFEcmxmZzRDUVBDLF9VNXJaU05KRFRQaGEwWFk0bktYVTRHcEJmYTFyR3Z6LDE2MzI3MzA0Ng0200FIW2i7oA?s=ap", "status_transitions": {"paid_at": 1772732242, "voided_at": null, "finalized_at": 1772732241, "marked_uncollectible_at": null}, "customer_tax_exempt": "none", "total_excluding_tax": 2900, "next_payment_attempt": null, "statement_descriptor": null, "webhooks_delivered_at": null, "default_payment_method": null, "subtotal_excluding_tax": 2900, "total_discount_amounts": [], "last_finalization_error": null, "automatically_finalizes_at": null, "total_pretax_credit_amounts": [], "pre_payment_credit_notes_amount": 0, "post_payment_credit_notes_amount": 0}	acct_1T7f81Drlfg4CQPC
2026-03-05 19:40:26.658115+00	2026-03-05 19:40:24+00	{"id": "in_1T7hkwDrlfg4CQPClWRj0jLM", "lines": {"url": "/v1/invoices/in_1T7hkwDrlfg4CQPClWRj0jLM/lines", "data": [{"id": "il_1T7hkwDrlfg4CQPCpqlC4mCT", "taxes": [], "amount": 2900, "object": "line_item", "parent": {"type": "subscription_item_details", "invoice_item_details": null, "subscription_item_details": {"proration": false, "invoice_item": null, "subscription": "sub_1T7hkyDrlfg4CQPCEdGcqSHC", "proration_details": {"credited_items": null}, "subscription_item": "si_U5tYus4nWYjzGT"}}, "period": {"end": 1775418022, "start": 1772739622}, "invoice": "in_1T7hkwDrlfg4CQPClWRj0jLM", "pricing": {"type": "price_details", "price_details": {"price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "product": "prod_U5r0eZMxeY4zkz"}, "unit_amount_decimal": "2900"}, "currency": "usd", "livemode": false, "metadata": {}, "quantity": 1, "subtotal": 2900, "discounts": [], "description": "1 × CLVRQuant Pro (at $29.00 / month)", "discountable": true, "discount_amounts": [], "pretax_credit_amounts": []}], "object": "list", "has_more": false, "total_count": 1}, "total": 2900, "footer": null, "issuer": {"type": "self"}, "number": "9WLOOLUU-0001", "object": "invoice", "parent": {"type": "subscription_details", "quote_details": null, "subscription_details": {"metadata": {}, "subscription": "sub_1T7hkyDrlfg4CQPCEdGcqSHC"}}, "status": "paid", "created": 1772739622, "currency": "usd", "customer": "cus_U5tYVPy20HEx9V", "due_date": null, "livemode": false, "metadata": {}, "subtotal": 2900, "attempted": true, "discounts": [], "rendering": null, "amount_due": 2900, "period_end": 1772739622, "test_clock": null, "amount_paid": 2900, "application": null, "description": null, "invoice_pdf": "https://pay.stripe.com/invoice/acct_1T7f81Drlfg4CQPC/test_YWNjdF8xVDdmODFEcmxmZzRDUVBDLF9VNXRZWHpDb09JbjRKTWp1TVNTR3YwNXgzeVhNSlpDLDE2MzI4MDQyNg0200HsVK8EWS/pdf?s=ap", "total_taxes": [], "account_name": "Alpha Scan Sandbox", "auto_advance": false, "effective_at": 1772739622, "from_invoice": null, "on_behalf_of": null, "period_start": 1772739622, "attempt_count": 0, "automatic_tax": {"status": null, "enabled": false, "provider": null, "liability": null, "disabled_reason": null}, "custom_fields": null, "customer_name": "mike c maba", "shipping_cost": null, "billing_reason": "subscription_create", "customer_email": "mikeclaver@gmail.com", "customer_phone": null, "default_source": null, "ending_balance": 0, "receipt_number": null, "account_country": "CA", "account_tax_ids": null, "amount_overpaid": 0, "amount_shipping": 0, "latest_revision": null, "amount_remaining": 0, "customer_account": null, "customer_address": {"city": null, "line1": null, "line2": null, "state": null, "country": "CA", "postal_code": "M5V 1M3"}, "customer_tax_ids": [], "payment_settings": {"default_mandate": null, "payment_method_types": null, "payment_method_options": {"card": {"request_three_d_secure": "automatic"}, "payto": null, "konbini": null, "acss_debit": null, "bancontact": null, "sepa_debit": null, "us_bank_account": null, "customer_balance": null}}, "shipping_details": null, "starting_balance": 0, "collection_method": "charge_automatically", "customer_shipping": null, "default_tax_rates": [], "hosted_invoice_url": "https://invoice.stripe.com/i/acct_1T7f81Drlfg4CQPC/test_YWNjdF8xVDdmODFEcmxmZzRDUVBDLF9VNXRZWHpDb09JbjRKTWp1TVNTR3YwNXgzeVhNSlpDLDE2MzI4MDQyNg0200HsVK8EWS?s=ap", "status_transitions": {"paid_at": 1772739623, "voided_at": null, "finalized_at": 1772739622, "marked_uncollectible_at": null}, "customer_tax_exempt": "none", "total_excluding_tax": 2900, "next_payment_attempt": null, "statement_descriptor": null, "webhooks_delivered_at": null, "default_payment_method": null, "subtotal_excluding_tax": 2900, "total_discount_amounts": [], "last_finalization_error": null, "automatically_finalizes_at": null, "total_pretax_credit_amounts": [], "pre_payment_credit_notes_amount": 0, "post_payment_credit_notes_amount": 0}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: payment_intents; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.payment_intents (_last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:37:23+00	{"id": "pi_3T7fpuDrlfg4CQPC4aSPQ9vH", "amount": 2900, "object": "payment_intent", "review": null, "source": null, "status": "succeeded", "created": 1772732242, "currency": "usd", "customer": "cus_U5rZNyf7DNdnQ2", "livemode": false, "metadata": {}, "shipping": null, "processing": null, "application": null, "canceled_at": null, "description": "Subscription creation", "next_action": null, "on_behalf_of": null, "client_secret": "pi_3T7fpuDrlfg4CQPC4aSPQ9vH_secret_WEjZS8ejF70DgtyOR4hFoIEFb", "latest_charge": "ch_3T7fpuDrlfg4CQPC4Yk8EcFP", "receipt_email": null, "transfer_data": null, "amount_details": {"tip": {}}, "capture_method": "automatic", "payment_method": "pm_1T7fptDrlfg4CQPC7IZiv22x", "transfer_group": null, "amount_received": 2900, "payment_details": {"order_reference": "cs_test_a1xas2OxJfSVt35Ph42fuZU4wSVECLPMTrdSZcXGYZTUr6IEOUwmrM5ste", "customer_reference": null}, "customer_account": null, "amount_capturable": 0, "last_payment_error": null, "setup_future_usage": "off_session", "cancellation_reason": null, "confirmation_method": "automatic", "presentment_details": {"presentment_amount": 4129, "presentment_currency": "cad"}, "payment_method_types": ["card"], "statement_descriptor": null, "application_fee_amount": null, "payment_method_options": {"card": {"network": null, "installments": null, "mandate_options": null, "setup_future_usage": "off_session", "request_three_d_secure": "automatic"}}, "automatic_payment_methods": null, "statement_descriptor_suffix": null, "excluded_payment_method_types": null, "payment_method_configuration_details": null}	acct_1T7f81Drlfg4CQPC
2026-03-05 19:40:23+00	{"id": "pi_3T7hkwDrlfg4CQPC30Nxls0K", "amount": 2900, "object": "payment_intent", "review": null, "source": null, "status": "succeeded", "created": 1772739622, "currency": "usd", "customer": "cus_U5tYVPy20HEx9V", "livemode": false, "metadata": {}, "shipping": null, "processing": null, "application": null, "canceled_at": null, "description": "Subscription creation", "next_action": null, "on_behalf_of": null, "client_secret": "pi_3T7hkwDrlfg4CQPC30Nxls0K_secret_ma008PbeW527Cp9O7owrCSvkK", "latest_charge": "ch_3T7hkwDrlfg4CQPC391IQ47i", "receipt_email": null, "transfer_data": null, "amount_details": {"tip": {}}, "capture_method": "automatic", "payment_method": "pm_1T7hkvDrlfg4CQPC5DShMPeu", "transfer_group": null, "amount_received": 2900, "payment_details": {"order_reference": "cs_test_a1qTUJtzjZgZRIX67qWsqIOy1MEOG3QhDv6X6dmmr4ipGcncDhMBF4VOIv", "customer_reference": null}, "customer_account": null, "amount_capturable": 0, "last_payment_error": null, "setup_future_usage": "off_session", "cancellation_reason": null, "confirmation_method": "automatic", "payment_method_types": ["card"], "statement_descriptor": null, "application_fee_amount": null, "payment_method_options": {"card": {"network": null, "installments": null, "mandate_options": null, "setup_future_usage": "off_session", "request_three_d_secure": "automatic"}}, "automatic_payment_methods": null, "statement_descriptor_suffix": null, "excluded_payment_method_types": null, "payment_method_configuration_details": null}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: payment_methods; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.payment_methods (_last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:37:23+00	{"id": "pm_1T7fptDrlfg4CQPC7IZiv22x", "card": {"brand": "visa", "last4": "4242", "checks": {"cvc_check": "pass", "address_line1_check": null, "address_postal_code_check": "pass"}, "wallet": null, "country": "US", "funding": "credit", "exp_year": 2027, "networks": {"available": ["visa"], "preferred": null}, "exp_month": 12, "fingerprint": "KFzXDwOamTOnhmhW", "display_brand": "visa", "generated_from": null, "regulated_status": "unregulated", "three_d_secure_usage": {"supported": true}}, "type": "card", "object": "payment_method", "created": 1772732241, "customer": "cus_U5rZNyf7DNdnQ2", "livemode": false, "metadata": {}, "allow_redisplay": "limited", "billing_details": {"name": "Mike C Mab", "email": "mikeclaver@gmail.com", "phone": null, "tax_id": null, "address": {"city": null, "line1": null, "line2": null, "state": null, "country": "CA", "postal_code": "M5V 1M3"}}, "customer_account": null}	acct_1T7f81Drlfg4CQPC
2026-03-05 19:40:23+00	{"id": "pm_1T7hkvDrlfg4CQPC5DShMPeu", "card": {"brand": "visa", "last4": "4242", "checks": {"cvc_check": "pass", "address_line1_check": null, "address_postal_code_check": "pass"}, "wallet": null, "country": "US", "funding": "credit", "exp_year": 2029, "networks": {"available": ["visa"], "preferred": null}, "exp_month": 8, "fingerprint": "KFzXDwOamTOnhmhW", "display_brand": "visa", "generated_from": null, "regulated_status": "unregulated", "three_d_secure_usage": {"supported": true}}, "type": "card", "object": "payment_method", "created": 1772739621, "customer": "cus_U5tYVPy20HEx9V", "livemode": false, "metadata": {}, "allow_redisplay": "limited", "billing_details": {"name": "mike c maba", "email": "mikeclaver@gmail.com", "phone": null, "tax_id": null, "address": {"city": null, "line1": null, "line2": null, "state": null, "country": "CA", "postal_code": "M5V 1M3"}}, "customer_account": null}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: payouts; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.payouts (_updated_at, _last_synced_at, _raw_data) FROM stdin;
\.


--
-- Data for Name: plans; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.plans (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:03:18.906033+00	2026-03-05 17:03:18+00	{"id": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "meter": null, "active": true, "amount": 2900, "object": "plan", "created": 1772730198, "product": "prod_U5r0eZMxeY4zkz", "currency": "usd", "interval": "month", "livemode": false, "metadata": {"plan": "pro_monthly"}, "nickname": null, "tiers_mode": null, "usage_type": "licensed", "amount_decimal": "2900", "billing_scheme": "per_unit", "interval_count": 1, "transform_usage": null, "trial_period_days": null}	acct_1T7f81Drlfg4CQPC
2026-03-05 17:03:19.002307+00	2026-03-05 17:03:18+00	{"id": "price_1T7fIwDrlfg4CQPCvyMVwhmM", "meter": null, "active": true, "amount": 19900, "object": "plan", "created": 1772730198, "product": "prod_U5r0eZMxeY4zkz", "currency": "usd", "interval": "year", "livemode": false, "metadata": {"plan": "pro_yearly"}, "nickname": null, "tiers_mode": null, "usage_type": "licensed", "amount_decimal": "19900", "billing_scheme": "per_unit", "interval_count": 1, "transform_usage": null, "trial_period_days": null}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: prices; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.prices (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-06 17:17:12.052696+00	2026-03-06 17:17:12.052+00	{"id": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "type": "recurring", "active": true, "object": "price", "created": 1772730198, "product": "prod_U5r0eZMxeY4zkz", "currency": "usd", "livemode": false, "metadata": {"plan": "pro_monthly"}, "nickname": null, "recurring": {"meter": null, "interval": "month", "usage_type": "licensed", "interval_count": 1, "trial_period_days": null}, "lookup_key": null, "tiers_mode": null, "unit_amount": 2900, "tax_behavior": "unspecified", "billing_scheme": "per_unit", "custom_unit_amount": null, "transform_quantity": null, "unit_amount_decimal": "2900"}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.products (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: refunds; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.refunds (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: reviews; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.reviews (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: setup_intents; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.setup_intents (_last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: subscription_items; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.subscription_items (_last_synced_at, _raw_data, _account_id) FROM stdin;
2026-03-05 17:37:25+00	{"id": "si_U5rZstNeAiXZML", "plan": {"id": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "meter": null, "active": true, "amount": 2900, "object": "plan", "created": 1772730198, "product": "prod_U5r0eZMxeY4zkz", "currency": "usd", "interval": "month", "livemode": false, "metadata": {"plan": "pro_monthly"}, "nickname": null, "tiers_mode": null, "usage_type": "licensed", "amount_decimal": "2900", "billing_scheme": "per_unit", "interval_count": 1, "transform_usage": null, "trial_period_days": null}, "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "subscription_item", "created": 1772732242, "deleted": false, "metadata": {}, "quantity": 1, "discounts": [], "tax_rates": [], "subscription": "sub_1T7fpwDrlfg4CQPCKOXDVn5i", "billing_thresholds": null, "current_period_end": 1775410641, "current_period_start": 1772732241}	acct_1T7f81Drlfg4CQPC
2026-03-05 19:40:25+00	{"id": "si_U5tYus4nWYjzGT", "plan": {"id": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "meter": null, "active": true, "amount": 2900, "object": "plan", "created": 1772730198, "product": "prod_U5r0eZMxeY4zkz", "currency": "usd", "interval": "month", "livemode": false, "metadata": {"plan": "pro_monthly"}, "nickname": null, "tiers_mode": null, "usage_type": "licensed", "amount_decimal": "2900", "billing_scheme": "per_unit", "interval_count": 1, "transform_usage": null, "trial_period_days": null}, "price": "price_1T7fIwDrlfg4CQPCtCTMcDXx", "object": "subscription_item", "created": 1772739622, "deleted": false, "metadata": {}, "quantity": 1, "discounts": [], "tax_rates": [], "subscription": "sub_1T7hkyDrlfg4CQPCEdGcqSHC", "billing_thresholds": null, "current_period_end": 1775418022, "current_period_start": 1772739622}	acct_1T7f81Drlfg4CQPC
\.


--
-- Data for Name: subscription_schedules; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.subscription_schedules (_last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.subscriptions (_updated_at, _last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Data for Name: tax_ids; Type: TABLE DATA; Schema: stripe; Owner: postgres
--

COPY stripe.tax_ids (_last_synced_at, _raw_data, _account_id) FROM stdin;
\.


--
-- Name: daily_briefs_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.daily_briefs_log_id_seq', 6, true);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.push_subscriptions_id_seq', 1, false);


--
-- Name: referrals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.referrals_id_seq', 1, false);


--
-- Name: user_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_alerts_id_seq', 1, true);


--
-- Name: webauthn_credentials_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.webauthn_credentials_id_seq', 3, true);


--
-- Name: _sync_status_id_seq; Type: SEQUENCE SET; Schema: stripe; Owner: postgres
--

SELECT pg_catalog.setval('stripe._sync_status_id_seq', 1, false);


--
-- Name: access_codes access_codes_code_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_codes
    ADD CONSTRAINT access_codes_code_unique UNIQUE (code);


--
-- Name: access_codes access_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_codes
    ADD CONSTRAINT access_codes_pkey PRIMARY KEY (id);


--
-- Name: daily_briefs_log daily_briefs_log_date_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_briefs_log
    ADD CONSTRAINT daily_briefs_log_date_key_key UNIQUE (date_key);


--
-- Name: daily_briefs_log daily_briefs_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_briefs_log
    ADD CONSTRAINT daily_briefs_log_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_user_id_subscription_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_subscription_key UNIQUE (user_id, subscription);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: subscribers subscribers_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_email_unique UNIQUE (email);


--
-- Name: subscribers subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_pkey PRIMARY KEY (id);


--
-- Name: user_alerts user_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (sid);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: webauthn_credentials webauthn_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: _migrations _migrations_name_key; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._migrations
    ADD CONSTRAINT _migrations_name_key UNIQUE (name);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: _sync_status _sync_status_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._sync_status
    ADD CONSTRAINT _sync_status_pkey PRIMARY KEY (id);


--
-- Name: _sync_status _sync_status_resource_account_key; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._sync_status
    ADD CONSTRAINT _sync_status_resource_account_key UNIQUE (resource, account_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: active_entitlements active_entitlements_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.active_entitlements
    ADD CONSTRAINT active_entitlements_pkey PRIMARY KEY (id);


--
-- Name: charges charges_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);


--
-- Name: checkout_session_line_items checkout_session_line_items_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.checkout_session_line_items
    ADD CONSTRAINT checkout_session_line_items_pkey PRIMARY KEY (id);


--
-- Name: checkout_sessions checkout_sessions_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.checkout_sessions
    ADD CONSTRAINT checkout_sessions_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: early_fraud_warnings early_fraud_warnings_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.early_fraud_warnings
    ADD CONSTRAINT early_fraud_warnings_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: features features_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.features
    ADD CONSTRAINT features_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: _managed_webhooks managed_webhooks_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._managed_webhooks
    ADD CONSTRAINT managed_webhooks_pkey PRIMARY KEY (id);


--
-- Name: _managed_webhooks managed_webhooks_url_account_unique; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._managed_webhooks
    ADD CONSTRAINT managed_webhooks_url_account_unique UNIQUE (url, account_id);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: prices prices_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.prices
    ADD CONSTRAINT prices_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: setup_intents setup_intents_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.setup_intents
    ADD CONSTRAINT setup_intents_pkey PRIMARY KEY (id);


--
-- Name: subscription_items subscription_items_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.subscription_items
    ADD CONSTRAINT subscription_items_pkey PRIMARY KEY (id);


--
-- Name: subscription_schedules subscription_schedules_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.subscription_schedules
    ADD CONSTRAINT subscription_schedules_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: tax_ids tax_ids_pkey; Type: CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.tax_ids
    ADD CONSTRAINT tax_ids_pkey PRIMARY KEY (id);


--
-- Name: idx_session_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_session_expire ON public.user_sessions USING btree (expire);


--
-- Name: idx_user_sessions_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_sessions_expire ON public.user_sessions USING btree (expire);


--
-- Name: users_referral_code_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_referral_code_unique ON public.users USING btree (referral_code) WHERE (referral_code IS NOT NULL);


--
-- Name: active_entitlements_lookup_key_key; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE UNIQUE INDEX active_entitlements_lookup_key_key ON stripe.active_entitlements USING btree (lookup_key) WHERE (lookup_key IS NOT NULL);


--
-- Name: features_lookup_key_key; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE UNIQUE INDEX features_lookup_key_key ON stripe.features USING btree (lookup_key) WHERE (lookup_key IS NOT NULL);


--
-- Name: idx_accounts_api_key_hashes; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX idx_accounts_api_key_hashes ON stripe.accounts USING gin (api_key_hashes);


--
-- Name: idx_accounts_business_name; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX idx_accounts_business_name ON stripe.accounts USING btree (business_name);


--
-- Name: idx_sync_status_resource_account; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX idx_sync_status_resource_account ON stripe._sync_status USING btree (resource, account_id);


--
-- Name: stripe_active_entitlements_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_active_entitlements_customer_idx ON stripe.active_entitlements USING btree (customer);


--
-- Name: stripe_active_entitlements_feature_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_active_entitlements_feature_idx ON stripe.active_entitlements USING btree (feature);


--
-- Name: stripe_checkout_session_line_items_price_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_checkout_session_line_items_price_idx ON stripe.checkout_session_line_items USING btree (price);


--
-- Name: stripe_checkout_session_line_items_session_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_checkout_session_line_items_session_idx ON stripe.checkout_session_line_items USING btree (checkout_session);


--
-- Name: stripe_checkout_sessions_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_checkout_sessions_customer_idx ON stripe.checkout_sessions USING btree (customer);


--
-- Name: stripe_checkout_sessions_invoice_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_checkout_sessions_invoice_idx ON stripe.checkout_sessions USING btree (invoice);


--
-- Name: stripe_checkout_sessions_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_checkout_sessions_payment_intent_idx ON stripe.checkout_sessions USING btree (payment_intent);


--
-- Name: stripe_checkout_sessions_subscription_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_checkout_sessions_subscription_idx ON stripe.checkout_sessions USING btree (subscription);


--
-- Name: stripe_credit_notes_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_credit_notes_customer_idx ON stripe.credit_notes USING btree (customer);


--
-- Name: stripe_credit_notes_invoice_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_credit_notes_invoice_idx ON stripe.credit_notes USING btree (invoice);


--
-- Name: stripe_dispute_created_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_dispute_created_idx ON stripe.disputes USING btree (created);


--
-- Name: stripe_early_fraud_warnings_charge_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_early_fraud_warnings_charge_idx ON stripe.early_fraud_warnings USING btree (charge);


--
-- Name: stripe_early_fraud_warnings_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_early_fraud_warnings_payment_intent_idx ON stripe.early_fraud_warnings USING btree (payment_intent);


--
-- Name: stripe_invoices_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_invoices_customer_idx ON stripe.invoices USING btree (customer);


--
-- Name: stripe_invoices_subscription_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_invoices_subscription_idx ON stripe.invoices USING btree (subscription);


--
-- Name: stripe_managed_webhooks_enabled_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_managed_webhooks_enabled_idx ON stripe._managed_webhooks USING btree (enabled);


--
-- Name: stripe_managed_webhooks_status_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_managed_webhooks_status_idx ON stripe._managed_webhooks USING btree (status);


--
-- Name: stripe_payment_intents_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_payment_intents_customer_idx ON stripe.payment_intents USING btree (customer);


--
-- Name: stripe_payment_intents_invoice_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_payment_intents_invoice_idx ON stripe.payment_intents USING btree (invoice);


--
-- Name: stripe_payment_methods_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_payment_methods_customer_idx ON stripe.payment_methods USING btree (customer);


--
-- Name: stripe_refunds_charge_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_refunds_charge_idx ON stripe.refunds USING btree (charge);


--
-- Name: stripe_refunds_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_refunds_payment_intent_idx ON stripe.refunds USING btree (payment_intent);


--
-- Name: stripe_reviews_charge_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_reviews_charge_idx ON stripe.reviews USING btree (charge);


--
-- Name: stripe_reviews_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_reviews_payment_intent_idx ON stripe.reviews USING btree (payment_intent);


--
-- Name: stripe_setup_intents_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_setup_intents_customer_idx ON stripe.setup_intents USING btree (customer);


--
-- Name: stripe_tax_ids_customer_idx; Type: INDEX; Schema: stripe; Owner: postgres
--

CREATE INDEX stripe_tax_ids_customer_idx ON stripe.tax_ids USING btree (customer);


--
-- Name: _managed_webhooks handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe._managed_webhooks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_metadata();


--
-- Name: _sync_status handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe._sync_status FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_metadata();


--
-- Name: accounts handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: active_entitlements handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.active_entitlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: charges handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.charges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: checkout_session_line_items handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.checkout_session_line_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: checkout_sessions handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.checkout_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: coupons handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: disputes handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.disputes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: early_fraud_warnings handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.early_fraud_warnings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: events handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: features handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.features FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoices handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payouts handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.payouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: plans handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prices handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.prices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refunds handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.refunds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: reviews handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: postgres
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: active_entitlements fk_active_entitlements_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.active_entitlements
    ADD CONSTRAINT fk_active_entitlements_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: charges fk_charges_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.charges
    ADD CONSTRAINT fk_charges_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: checkout_session_line_items fk_checkout_session_line_items_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.checkout_session_line_items
    ADD CONSTRAINT fk_checkout_session_line_items_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: checkout_sessions fk_checkout_sessions_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.checkout_sessions
    ADD CONSTRAINT fk_checkout_sessions_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: credit_notes fk_credit_notes_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.credit_notes
    ADD CONSTRAINT fk_credit_notes_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: customers fk_customers_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.customers
    ADD CONSTRAINT fk_customers_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: disputes fk_disputes_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.disputes
    ADD CONSTRAINT fk_disputes_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: early_fraud_warnings fk_early_fraud_warnings_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.early_fraud_warnings
    ADD CONSTRAINT fk_early_fraud_warnings_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: features fk_features_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.features
    ADD CONSTRAINT fk_features_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: invoices fk_invoices_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.invoices
    ADD CONSTRAINT fk_invoices_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: _managed_webhooks fk_managed_webhooks_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._managed_webhooks
    ADD CONSTRAINT fk_managed_webhooks_account FOREIGN KEY (account_id) REFERENCES stripe.accounts(id);


--
-- Name: payment_intents fk_payment_intents_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.payment_intents
    ADD CONSTRAINT fk_payment_intents_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: payment_methods fk_payment_methods_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.payment_methods
    ADD CONSTRAINT fk_payment_methods_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: plans fk_plans_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.plans
    ADD CONSTRAINT fk_plans_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: prices fk_prices_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.prices
    ADD CONSTRAINT fk_prices_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: products fk_products_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.products
    ADD CONSTRAINT fk_products_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: refunds fk_refunds_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.refunds
    ADD CONSTRAINT fk_refunds_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: reviews fk_reviews_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.reviews
    ADD CONSTRAINT fk_reviews_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: setup_intents fk_setup_intents_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.setup_intents
    ADD CONSTRAINT fk_setup_intents_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: subscription_items fk_subscription_items_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.subscription_items
    ADD CONSTRAINT fk_subscription_items_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: subscription_schedules fk_subscription_schedules_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.subscription_schedules
    ADD CONSTRAINT fk_subscription_schedules_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: subscriptions fk_subscriptions_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.subscriptions
    ADD CONSTRAINT fk_subscriptions_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: _sync_status fk_sync_status_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe._sync_status
    ADD CONSTRAINT fk_sync_status_account FOREIGN KEY (account_id) REFERENCES stripe.accounts(id);


--
-- Name: tax_ids fk_tax_ids_account; Type: FK CONSTRAINT; Schema: stripe; Owner: postgres
--

ALTER TABLE ONLY stripe.tax_ids
    ADD CONSTRAINT fk_tax_ids_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- PostgreSQL database dump complete
--

\unrestrict fDQCVrBeWjMBNnZrk0yB7PHTSykVrO3Px1TKX6UVdBX51MTlHckwhR2uXSVFbU5

