alter table public.vendors add column if not exists address text;
alter table public.vendors add constraint vendors_address_length check(address is null or length(address)<=2000);
